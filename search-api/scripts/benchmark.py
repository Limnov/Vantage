#!/usr/bin/env python3
import argparse
import asyncio
import json
import math
import os
import re
import statistics
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx


def load_cases(path: str) -> list[dict]:
    cases = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            cases.append(json.loads(line))
    return cases


def domains(results: list[dict], k: int = 5) -> set[str]:
    out = set()
    for item in results[:k]:
        host = (urlparse(item.get("url", "")).hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if host:
            out.add(host)
    return out


def expected_hit(case: dict, results: list[dict], k: int = 5) -> bool | None:
    expected = [x.lower() for x in case.get("expected_terms", [])]
    if not expected:
        return None
    for item in results[:k]:
        text = f"{item.get('title','')} {item.get('content','')} {item.get('snippet','')}".lower()
        if all(term in text for term in expected):
            return True
    return False


def expected_url_rank(case: dict, results: list[dict]) -> int | None:
    expected = case.get("expected_url")
    if not expected:
        return None

    def identity(url: str) -> tuple[str, str]:
        parsed = urlparse(url)
        return (parsed.hostname or "").lower().removeprefix("www."), parsed.path.rstrip("/")

    target = identity(expected)
    return next((rank for rank, item in enumerate(results, start=1) if identity(item.get("url", "")) == target), None)


def numeric_mismatch(case: dict, results: list[dict], k: int = 5) -> bool:
    query = case["query"]
    nums = []
    for match in re.finditer(r"\b\d+[a-z0-9-]*\b", query.lower()):
        token = match.group()
        following = query[match.end():].lstrip().lower()
        if token.isdigit() and len(token) <= 3 and re.match(
            r"(?:天|日|周|月|年|小时|days?\b|weeks?\b|months?\b|hours?\b)",
            following,
        ):
            continue
        if token.isdigit() and 1900 <= int(token) <= datetime.now().year + 1:
            continue
        nums.append(token)
    if not nums:
        return False
    for item in results[:k]:
        text = f"{item.get('title','')} {item.get('content','')}".lower()
        if text and not any(n in text for n in nums):
            return True
    return False


def request_bodies(case: dict, max_results: int, today: datetime | None = None) -> tuple[dict, dict]:
    topic = case.get("topic") or ("news" if case.get("search_mode") == "news" else "general")
    local = {
        "query": case["query"],
        "topic": topic,
        "search_depth": "advanced",
        "max_results": max_results,
        "include_raw_content": False,
        "language": case.get("language") or "auto",
    }
    tavily = {
        "query": case["query"],
        "topic": topic,
        "search_depth": "advanced",
        "max_results": max_results,
        "include_answer": False,
        "include_raw_content": False,
        "include_published_date": True,
        "filter_by_published_date": False,
        "include_usage": True,
        "auto_parameters": False,
    }

    if case.get("language") and case["language"] != "auto":
        tavily["language"] = case["language"]
        tavily["filter_by_language"] = False

    if case.get("days"):
        days = int(case["days"])
        local["days"] = days
        anchor = (today or datetime.now(timezone.utc)).date()
        tavily["start_date"] = (anchor - timedelta(days=days)).isoformat()
        tavily["end_date"] = anchor.isoformat()

    region = case.get("region") or case.get("country")
    if region:
        local["country"] = region
        if topic == "general":
            mapped = {
                "us": "united states", "usa": "united states",
                "united states": "united states", "美国": "united states",
                "canada": "canada", "加拿大": "canada",
            }.get(str(region).strip().lower())
            if mapped:
                tavily["country"] = mapped

    for field in ("include_domains", "exclude_domains"):
        if case.get(field):
            local[field] = case[field]
            tavily[field] = case[field]

    site = re.search(r"(?<!\S)site:([a-z0-9.-]+)", case["query"], flags=re.I)
    if site and not tavily.get("include_domains"):
        tavily["include_domains"] = [site.group(1).lower().removeprefix("www.")]
    if tavily.get("include_domains"):
        tavily["include_domains_mode"] = "restrict"
    return local, tavily


def comparison_notes(case: dict, tavily_body: dict) -> list[str]:
    notes = []
    region = case.get("region") or case.get("country")
    if region and "country" not in tavily_body:
        notes.append("region_not_mapped_to_tavily_country")
    if case.get("search_mode") == "product":
        notes.append("product_mode_mapped_to_general")
    if case.get("days"):
        notes.append("date_filter_semantics_may_differ")
    return notes


async def call_local(client: httpx.AsyncClient, base: str, body: dict) -> tuple[dict, float]:
    start = time.perf_counter()
    response = await client.post(f"{base.rstrip('/')}/search", json=body)
    response.raise_for_status()
    return response.json(), time.perf_counter() - start


async def call_tavily(client: httpx.AsyncClient, key: str, body: dict) -> tuple[dict, float]:
    start = time.perf_counter()
    response = await client.post(
        "https://api.tavily.com/search",
        json=body,
        headers={"Authorization": f"Bearer {key}"},
    )
    response.raise_for_status()
    return response.json(), time.perf_counter() - start


def summarize(rows: list[dict], name: str) -> dict:
    own = [r for r in rows if r["provider"] == name]
    if not own:
        return {}
    labeled = [r for r in own if r["expected_hit"] is not None]
    source_labeled = [r for r in own if r["expected_url"]]
    latencies = sorted(r["latency_s"] for r in own)
    return {
        "provider": name,
        "queries": len(own),
        "labeled_queries": len(labeled),
        "expected_top5_hit_rate": round(sum(r["expected_hit"] for r in labeled) / len(labeled), 3) if labeled else None,
        "source_top3_hit_rate": round(sum(r["expected_url_rank"] is not None and r["expected_url_rank"] <= 3 for r in source_labeled) / len(source_labeled), 3) if source_labeled else None,
        "source_top5_hit_rate": round(sum(r["expected_url_rank"] is not None and r["expected_url_rank"] <= 5 for r in source_labeled) / len(source_labeled), 3) if source_labeled else None,
        "numeric_mismatch_rate": round(sum(r["numeric_mismatch"] for r in own) / len(own), 3),
        "avg_unique_domains_top5": round(statistics.mean(r["unique_domains_top5"] for r in own), 2),
        "p50_latency_s": round(statistics.median(latencies), 3),
        "p95_latency_s": round(latencies[math.ceil(0.95 * len(latencies)) - 1], 3),
        "avg_latency_s": round(statistics.mean(r["latency_s"] for r in own), 3),
        "avg_results": round(statistics.mean(r["result_count"] for r in own), 2),
        "empty_result_rate": round(sum(r["result_count"] == 0 for r in own) / len(own), 3),
        "cache_hit_rate": round(sum(r["cached"] for r in own) / len(own), 3),
    }


async def main():
    parser = argparse.ArgumentParser(description="Run paired Search API / Tavily evaluation on observed queries")
    parser.add_argument("--queries", default="benchmarks/queries.sample.jsonl")
    parser.add_argument("--base-url", default=os.getenv("VANTAGE_SEARCH_API_URL", "http://127.0.0.1:8787"))
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument("--run-tavily", action="store_true", help="Make paid Tavily API requests")
    parser.add_argument("--max-tavily-requests", type=int, default=0, help="Hard cap on Tavily requests in this run")
    parser.add_argument("--tavily-journal", help="New append-only file recording each Tavily attempt before sending")
    parser.add_argument("--output", help="Write the JSON report to this file")
    args = parser.parse_args()
    if not 1 <= args.max_results <= 20:
        parser.error("--max-results must be between 1 and 20")

    tavily_key = os.getenv("TAVILY_API_KEY", "") if args.run_tavily else ""
    if args.run_tavily and not tavily_key:
        parser.error("TAVILY_API_KEY is required with --run-tavily")

    cases = load_cases(args.queries)
    if args.run_tavily:
        if not args.output or not args.tavily_journal:
            parser.error("--output and --tavily-journal are required with --run-tavily")
        if not 0 < args.max_tavily_requests <= 10 or len(cases) > args.max_tavily_requests:
            parser.error("case count must not exceed --max-tavily-requests (1–10)")
        if Path(args.output).exists() or Path(args.tavily_journal).exists():
            parser.error("output and journal must be new files; never repeat a paid run")
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.tavily_journal).parent.mkdir(parents=True, exist_ok=True)

    run_at = datetime.now(timezone.utc)
    rows = []
    headers = {}
    local_key = os.getenv("VANTAGE_SEARCH_API_KEY") or os.getenv("SEARCH_API_KEY")
    if local_key:
        headers["Authorization"] = f"Bearer {local_key}"

    journal = Path(args.tavily_journal).open("x", encoding="utf-8") if args.run_tavily else None
    async with httpx.AsyncClient(timeout=40, headers=headers) as local_client, httpx.AsyncClient(timeout=40) as external_client:
        for case in cases:
            local_body, tavily_body = request_bodies(case, args.max_results, run_at)
            local_payload, latency = await call_local(local_client, args.base_url, local_body)
            local_results = local_payload.get("results", [])
            rows.append({
                "provider": "vantage-search",
                "id": case.get("id"),
                "query": case["query"],
                "comparison_notes": comparison_notes(case, tavily_body),
                "request": local_body,
                "latency_s": latency,
                "result_count": len(local_results),
                "unique_domains_top5": len(domains(local_results)),
                "expected_hit": expected_hit(case, local_results),
                "expected_url": case.get("expected_url"),
                "expected_url_rank": expected_url_rank(case, local_results),
                "numeric_mismatch": numeric_mismatch(case, local_results),
                "cached": bool(local_payload.get("cached")),
                "top3_urls": [item.get("url", "") for item in local_results[:3]],
                "results": local_results,
            })

            if args.run_tavily:
                journal.write(json.dumps({"id": case.get("id"), "attempted_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False) + "\n")
                journal.flush()
                os.fsync(journal.fileno())
                tavily_payload, tavily_latency = await call_tavily(external_client, tavily_key, tavily_body)
                tavily_results = tavily_payload.get("results", [])
                rows.append({
                    "provider": "tavily",
                    "id": case.get("id"),
                    "query": case["query"],
                    "comparison_notes": comparison_notes(case, tavily_body),
                    "request": tavily_body,
                    "latency_s": tavily_latency,
                    "result_count": len(tavily_results),
                    "unique_domains_top5": len(domains(tavily_results)),
                    "expected_hit": expected_hit(case, tavily_results),
                    "expected_url": case.get("expected_url"),
                    "expected_url_rank": expected_url_rank(case, tavily_results),
                    "numeric_mismatch": numeric_mismatch(case, tavily_results),
                    "cached": False,
                    "top3_urls": [item.get("url", "") for item in tavily_results[:3]],
                    "results": tavily_results,
                    "usage": tavily_payload.get("usage"),
                })
                checkpoint = {
                    "run_at": run_at.isoformat(),
                    "query_count": len(cases),
                    "summary": [summarize(rows, p) for p in sorted({r["provider"] for r in rows})],
                    "cases": rows,
                }
                target = Path(args.output)
                temporary = target.with_name(target.name + ".tmp")
                temporary.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                temporary.replace(target)

    if journal:
        journal.close()

    providers = sorted({r["provider"] for r in rows})
    report = {
            "run_at": run_at.isoformat(),
            "query_count": len(cases),
            "summary": [summarize(rows, p) for p in providers],
            "cases": rows,
        }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered + "\n", encoding="utf-8")
        print(json.dumps({"output": str(target), "summary": report["summary"]}, ensure_ascii=False, indent=2))
    else:
        print(rendered)


if __name__ == "__main__":
    asyncio.run(main())
