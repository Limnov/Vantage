import asyncio

import httpx

import app.main as main_module
from app.search import SearchBackendError


async def request(method: str, path: str, **kwargs):
    transport = httpx.ASGITransport(app=main_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


def test_search_contract(monkeypatch):
    async def fake_run_search(req):
        return [{
            "title": "OpenAI API Pricing",
            "url": "https://openai.com/api/pricing",
            "content": "Current API pricing",
            "snippet": "Current API pricing",
            "score": 0.91,
            "published_date": None,
            "engines": ["bing", "google"],
            "searx_score": 1.0,
        }]

    monkeypatch.setattr(main_module, "run_search", fake_run_search)
    response = asyncio.run(request(
        "POST",
        "/search",
        json={"query": "OpenAI API pricing", "max_results": 5},
    ))

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "OpenAI API pricing"
    assert payload["cached"] is False
    assert payload["answer"] is None
    assert payload["results"][0]["score"] == 0.91
    assert payload["request_id"]


def test_search_backend_error_becomes_502(monkeypatch):
    async def fail(_req):
        raise SearchBackendError("all SearXNG search tasks failed")

    monkeypatch.setattr(main_module, "run_search", fail)
    response = asyncio.run(request(
        "POST",
        "/search",
        json={"query": "test"},
    ))

    assert response.status_code == 502
    assert response.json()["error"] == "search_backend_unavailable"


def test_api_key_can_protect_search(monkeypatch):
    monkeypatch.setattr(main_module.settings, "search_api_key", "local-secret")

    async def fake_run_search(_req):
        return []

    monkeypatch.setattr(main_module, "run_search", fake_run_search)

    unauthorized = asyncio.run(request(
        "POST",
        "/search",
        json={"query": "test"},
    ))
    assert unauthorized.status_code == 401

    authorized = asyncio.run(request(
        "POST",
        "/search",
        headers={"Authorization": "Bearer local-secret"},
        json={"query": "test"},
    ))
    assert authorized.status_code == 200


def test_ready_requires_search_results(monkeypatch):
    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def get(self, _url, **kwargs):
            assert kwargs["params"]["format"] == "json"
            return httpx.Response(200, json={"results": []})

    monkeypatch.setattr(main_module.httpx, "AsyncClient", FakeClient)
    response = asyncio.run(main_module.ready())
    assert response.status_code == 503
    assert response.body == b'{"status":"degraded","checks":{"searxng":false,"redis":false}}'


def test_cache_key_tracks_default_engines(monkeypatch):
    req = main_module.SearchRequest(query="OpenAI pricing")
    monkeypatch.setattr(main_module.settings, "default_engines", "yahoo,yandex")
    first = main_module.cache_key(req)
    monkeypatch.setattr(main_module.settings, "default_engines", "bing,google")
    assert main_module.cache_key(req) != first
