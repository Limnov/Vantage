import hashlib
import json
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from .config import settings
from .extract import fetch_and_extract
from .models import ExtractRequest, SearchRequest
from .search import SearchBackendError, run_search, search_warnings

redis_client: Redis | None = None
CACHE_VERSION = 11
stats = {
    "requests": 0,
    "searches": 0,
    "cache_hits": 0,
    "errors": 0,
    "http_latency_ms_total": 0,
    "search_latency_ms_total": 0,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    try:
        redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
        await redis_client.ping()
    except Exception:
        redis_client = None
    yield
    if redis_client is not None:
        await redis_client.aclose()


app = FastAPI(
    title="Vantage Search API",
    version="1.0.0",
    description="SearXNG-based search API with multi-engine fusion, ranking, extraction and Tavily-like response shape.",
    lifespan=lifespan,
)


async def require_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    if not settings.search_api_key:
        return
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    if x_api_key != settings.search_api_key and bearer != settings.search_api_key:
        raise HTTPException(status_code=401, detail="invalid API key")


def cache_key(req: SearchRequest) -> str:
    payload = req.model_dump(mode="json", exclude_none=True)
    payload["_backend"] = {
        "version": CACHE_VERSION,
        "engines": req.engines or settings.engines,
        "max_advanced_tasks": settings.max_advanced_tasks,
        "max_query_variants": settings.max_query_variants,
        "max_results": settings.max_results,
        "max_results_per_domain": settings.max_results_per_domain,
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    return "search:" + hashlib.sha256(raw).hexdigest()


@app.middleware("http")
async def request_metrics(request: Request, call_next):
    start = time.perf_counter()
    stats["requests"] += 1
    try:
        response = await call_next(request)
        return response
    except Exception:
        stats["errors"] += 1
        raise
    finally:
        stats["http_latency_ms_total"] += int((time.perf_counter() - start) * 1000)


@app.exception_handler(SearchBackendError)
async def backend_error(_: Request, exc: SearchBackendError):
    stats["errors"] += 1
    return JSONResponse(
        status_code=502,
        content={"error": "search_backend_unavailable", "message": str(exc)},
    )


@app.exception_handler(Exception)
async def unhandled_error(_: Request, exc: Exception):
    stats["errors"] += 1
    return JSONResponse(status_code=500, content={"error": "internal_error", "message": str(exc)})


@app.get("/health")
async def health():
    redis_ok = False
    if redis_client is not None:
        try:
            redis_ok = bool(await redis_client.ping())
        except Exception:
            pass
    return {
        "status": "ok",
        "service": "vantage-search-api",
        "version": app.version,
        "searxng": settings.searxng_url,
        "redis": redis_ok,
        "engines": settings.engines,
    }


@app.get("/ready")
async def ready():
    checks = {"searxng": False, "redis": redis_client is not None}

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.get(
                f"{settings.searxng_url.rstrip('/')}/search",
                params={
                    "q": "openai",
                    "format": "json",
                    "language": "en",
                    "engines": ",".join(settings.engines),
                },
            )
            response.raise_for_status()
            checks["searxng"] = bool(response.json().get("results"))
    except Exception:
        checks["searxng"] = False

    if redis_client is not None:
        try:
            checks["redis"] = bool(await redis_client.ping())
        except Exception:
            checks["redis"] = False

    status = "ready" if checks["searxng"] else "degraded"
    return JSONResponse(
        status_code=200 if checks["searxng"] else 503,
        content={"status": status, "checks": checks},
    )


@app.get("/metrics", dependencies=[Depends(require_api_key)])
async def metrics():
    searches = max(1, stats["searches"])
    requests = max(1, stats["requests"])
    return {
        **stats,
        "avg_search_latency_ms": round(stats["search_latency_ms_total"] / searches, 1),
        "avg_http_latency_ms": round(stats["http_latency_ms_total"] / requests, 1),
    }


@app.post("/search", dependencies=[Depends(require_api_key)])
async def search(req: SearchRequest):
    stats["searches"] += 1
    started = time.perf_counter()
    key = cache_key(req)

    try:
        if redis_client is not None:
            try:
                cached = await redis_client.get(key)
                if cached:
                    stats["cache_hits"] += 1
                    data = json.loads(cached)
                    data["cached"] = True
                    return data
            except Exception:
                pass

        results = await run_search(req)
        response = {
            "query": req.query,
            "answer": None,
            "response_time": round(time.perf_counter() - started, 3),
            "results": results,
            "warnings": search_warnings(req, len(results)),
            "request_id": uuid.uuid4().hex,
            "cached": False,
        }

        if redis_client is not None:
            try:
                await redis_client.set(key, json.dumps(response, ensure_ascii=False), ex=settings.cache_ttl_seconds)
            except Exception:
                pass
        return response
    finally:
        stats["search_latency_ms_total"] += int((time.perf_counter() - started) * 1000)


@app.get("/search", dependencies=[Depends(require_api_key)])
async def search_get(
    q: str,
    max_results: int = 8,
    search_depth: str = "basic",
    topic: str = "general",
    time_range: str | None = None,
    include_raw_content: bool = False,
):
    try:
        req = SearchRequest(
            query=q,
            max_results=max_results,
            search_depth=search_depth,
            topic=topic,
            time_range=time_range,
            include_raw_content=include_raw_content,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await search(req)


@app.post("/extract", dependencies=[Depends(require_api_key)])
async def extract(req: ExtractRequest):
    urls = [req.urls] if isinstance(req.urls, str) else req.urls
    if len(urls) > 10:
        raise HTTPException(status_code=400, detail="maximum 10 URLs per request")

    results = []
    for url in urls:
        try:
            results.append(await fetch_and_extract(url, req.max_chars))
        except Exception as exc:
            results.append({"url": url, "error": str(exc)})
    return {"results": results}


@app.get("/")
async def root():
    return {
        "service": "Vantage Search API",
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
    }
