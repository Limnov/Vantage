from app.models import SearchRequest
import asyncio
from datetime import datetime, timedelta, timezone

import app.search as search_module
from app.search import (
    SearchBackendError,
    build_query_variants,
    build_search_tasks,
    diversify_results,
    domain_allowed,
    date_within_request,
    effective_time_range,
    fuse_results,
    lexical_score,
    market_entity_matches,
    market_focus,
    normalize_url,
    numeric_tokens,
    plan_retrieval_query,
    query_market_focus,
    run_search,
    search_searx,
    snippet_published_date,
    source_format_multiplier,
)


def test_normalize_url_removes_tracking():
    assert normalize_url("https://example.com/a/?utm_source=x&id=1") == "https://example.com/a?id=1"


def test_numeric_model_mismatch_is_penalized():
    good = lexical_score("RTX 4090 price", "RTX 4090 price", "GPU pricing")
    bad = lexical_score("RTX 4090 price", "RTX 5090 price", "GPU pricing")
    assert good > 0.9
    assert bad <= 0.12


def test_recent_days_are_not_a_model_constraint():
    query = "研究最近 30 天手机配件在美国市场的机会和风险。"
    assert numeric_tokens(query) == []
    assert effective_time_range(SearchRequest(query=query)) == "month"
    assert plan_retrieval_query(query) == "手机配件 美国 市场"
    assert numeric_tokens("RTX 4090 price 2026") == ["4090"]


def test_publication_year_does_not_remove_original_paper():
    req = SearchRequest(query="BEIR benchmark original paper zero shot retrieval 2021")
    group = [{
        "title": "BEIR: A Heterogenous Benchmark for Zero-shot Evaluation of Information Retrieval Models",
        "url": "https://arxiv.org/abs/2104.08663",
        "content": "We introduce Benchmarking-IR (BEIR), a heterogeneous evaluation benchmark.",
        "engines": ["yahoo"],
        "searx_score": 1.0,
    }]
    assert [item["url"] for item in fuse_results([group], req)] == ["https://arxiv.org/abs/2104.08663"]


def test_market_research_planner_adds_market_and_regulatory_queries():
    req = SearchRequest(
        query="研究最近 30 天北美便携储能市场的机会和风险，核验关键来源。",
        search_depth="basic",
    )
    assert market_focus(req.query).sector == "便携储能"
    assert plan_retrieval_query(req.query) == "便携储能 北美 市场"
    variants = build_query_variants(req)
    assert variants[0] == "便携储能 北美 市场"
    assert any("portable power station" in query and "market" in query for query in variants)
    assert any("UL 2743" in query for query in variants)
    assert len(build_search_tasks(req)) == 3


def test_market_research_requires_the_actual_sector():
    focus = market_focus("研究最近 30 天手机配件在美国市场的机会和风险。")
    assert market_entity_matches(focus, "iPhone 配件在美国需求增长")
    assert not market_entity_matches(focus, "美国金融市场风险和经济压力")
    req = SearchRequest(query="研究最近 30 天手机配件在美国市场的机会和风险。")
    group = [
        {"title": "美国金融市场风险", "url": "https://example.com/finance", "content": "美国市场有风险", "engines": ["yahoo"], "searx_score": 10.0},
        {"title": "美国手机配件市场", "url": "https://example.com/accessories", "content": "手机配件需求", "engines": ["yahoo"], "searx_score": 1.0},
    ]
    assert [item["url"] for item in fuse_results([group], req)] == ["https://example.com/accessories"]


def test_market_research_prefers_sector_in_title_and_target_region():
    req = SearchRequest(query="研究最近 30 天北美便携储能市场的机会和风险。")
    group = [
        {"title": "全球新能源市场展望", "url": "https://example.com/generic", "content": "北美便携储能市场增长", "engines": ["yahoo"], "searx_score": 1.0},
        {"title": "便携储能北美市场趋势", "url": "https://example.org/focused", "content": "北美便携储能市场增长", "engines": ["yahoo"], "searx_score": 1.0},
    ]
    ranked = fuse_results([group], req)
    assert ranked[0]["url"] == "https://example.org/focused"


def test_agent_phrase_market_query_adds_english_variant_and_removes_generic_results():
    req = SearchRequest(
        query="手机配件 美国市场 趋势 机会 风险",
        topic="news",
        days=30,
        country="美国",
        search_depth="advanced",
    )
    assert query_market_focus(req.query) == search_module.MarketFocus("手机配件", "美国")
    variants = build_query_variants(req)
    assert any("mobile phone accessories United States market" in value for value in variants)
    assert not any("mobile phone accessories United States market 2026" in value for value in variants)

    group = [
        {"title": "美国市场与成人内容趋势", "url": "https://example.com/unrelated", "content": "美国市场趋势 机会 风险", "engines": ["yahoo"], "searx_score": 5.0},
        {"title": "US mobile phone accessories market", "url": "https://example.org/accessories", "content": "phone accessories in the United States", "engines": ["yahoo"], "searx_score": 1.0},
    ]
    assert [item["url"] for item in fuse_results([group], req)] == ["https://example.org/accessories"]


def test_agent_phrase_year_page_does_not_match_portable_energy_sector():
    req = SearchRequest(query="便携储能 北美 市场 2025 趋势", topic="news", days=30)
    group = [
        {"title": "2025 - Wikipedia", "url": "https://en.wikipedia.org/wiki/2025", "content": "2025 was a year", "engines": ["yahoo"], "searx_score": 10.0},
        {"title": "北美便携储能市场", "url": "https://example.com/portable", "content": "portable power station North America", "engines": ["yahoo"], "searx_score": 1.0},
    ]
    assert [item["url"] for item in fuse_results([group], req)] == ["https://example.com/portable"]


def test_snippet_date_is_explicitly_marked_as_search_metadata():
    assert snippet_published_date("Sep 7, 2026 · North America market report") == "2026-09-07"
    assert snippet_published_date("A report quotes Sep 7, 2026 · as a comparison") is None
    assert snippet_published_date("Sep 7, 2099 · Future estimate") is None

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"results": [{
                "title": "US Mobile Accessories Market",
                "url": "https://example.com/market",
                "content": "Sep 7, 2026 · US mobile accessories market analysis",
                "engine": "yahoo",
            }]}

    class FakeClient:
        async def get(self, *args, **kwargs):
            return FakeResponse()

    results = asyncio.run(search_searx("mobile accessories", SearchRequest(query="mobile accessories"), client=FakeClient()))
    assert results[0]["published_date"] == "2026-09-07"
    assert results[0]["published_date_source"] == "search_snippet"


def test_known_old_date_is_excluded_but_unknown_date_remains():
    today = datetime.now(timezone.utc).date()
    req = SearchRequest(query="portable power station recall", topic="news", days=30)
    old = (today - timedelta(days=45)).isoformat()
    recent = (today - timedelta(days=5)).isoformat()
    assert not date_within_request(old, req)
    assert date_within_request(recent, req)
    assert date_within_request(None, req)
    group = [
        {"title": "Portable power station recall", "url": "https://old.example/recall", "content": "A power station recall", "published_date": old, "engines": ["yahoo"], "searx_score": 10.0},
        {"title": "Portable power station recall", "url": "https://recent.example/recall", "content": "A power station recall", "published_date": recent, "engines": ["yahoo"], "searx_score": 1.0},
        {"title": "Portable power station recall", "url": "https://unknown.example/recall", "content": "A power station recall", "published_date": None, "engines": ["yahoo"], "searx_score": 1.0},
    ]
    assert {item["url"] for item in fuse_results([group], req)} == {
        "https://recent.example/recall", "https://unknown.example/recall",
    }


def test_social_posts_are_demoted_for_research_queries():
    query = "9800X3D review benchmark"
    assert source_format_multiplier("https://www.tiktok.com/@someone/video/123", query) < 1
    assert source_format_multiplier("https://www.youtube.com/watch?v=123", query) < 1
    assert source_format_multiplier("https://gamersnexus.net/cpus/9800x3d-review", query) == 1
    assert source_format_multiplier("https://seller.tiktok.com/", "TikTok Shop policy") == 1


def test_multi_engine_consensus_improves_rank():
    req = SearchRequest(query="Vantage Search API")
    groups = [
        [
            {"title": "Vantage Search API docs", "url": "https://example.com/docs", "content": "Vantage Search API", "engines": ["bing"], "positions": [], "searx_score": 1.0, "_rank": 1, "_variant_query": req.query},
            {"title": "Other", "url": "https://other.example/x", "content": "unrelated", "engines": ["bing"], "positions": [], "searx_score": 1.0, "_rank": 2, "_variant_query": req.query},
        ],
        [
            {"title": "Vantage Search API docs", "url": "https://example.com/docs?utm_source=y", "content": "Vantage Search API documentation", "engines": ["google"], "positions": [], "searx_score": 1.0, "_rank": 1, "_variant_query": req.query},
        ],
    ]
    ranked = fuse_results(groups, req)
    assert ranked[0]["url"].startswith("https://example.com/docs")
    assert set(ranked[0]["engines"]) == {"bing", "google"}


def test_include_domain_affects_retrieval_query():
    req = SearchRequest(
        query="OpenAI API pricing",
        include_domains=["openai.com"],
        search_depth="advanced",
    )
    variants = build_query_variants(req)
    assert any(q.startswith("site:openai.com ") for q in variants)


def test_mixed_language_named_entities_get_latin_retrieval_variant():
    paper = SearchRequest(query="BEIR 零样本信息检索基准 原始论文 arxiv", search_depth="advanced")
    project = SearchRequest(query="RAG 检索评测 ir_measures 开源项目 GitHub", search_depth="advanced")
    generic = SearchRequest(query="AI 开源项目 GitHub", search_depth="advanced")
    assert "BEIR arxiv" in build_query_variants(paper)
    assert "RAG ir_measures GitHub" in build_query_variants(project)
    assert build_query_variants(generic) == [generic.query]


def test_mixed_language_original_source_is_not_buried_by_chinese_lexical_overlap():
    req = SearchRequest(query="BEIR 零样本信息检索基准 原始论文 arxiv", search_depth="advanced")
    group = [
        {"title": "BEIR: A Heterogenous Benchmark for Zero-shot Evaluation", "url": "https://arxiv.org/abs/2104.08663", "content": "Benchmarking-IR paper", "engines": ["yahoo"], "searx_score": 1.0},
        {"title": "BEIR 零样本信息检索基准 原始论文笔记", "url": "https://example.com/beir-notes", "content": "中文读书笔记", "engines": ["yahoo"], "searx_score": 1.0},
    ]
    assert fuse_results([group], req)[0]["url"] == "https://arxiv.org/abs/2104.08663"


def test_site_operator_filters_host_and_path_and_adds_short_query():
    req = SearchRequest(
        query="site:cpsc.gov/Recalls/ Goal Zero YETI 3000X recall 2026 circuit board overheat fire burn hazard",
        search_depth="advanced",
    )
    assert "site:cpsc.gov/Recalls/ Goal Zero YETI 3000X recall 2026" in build_query_variants(req)
    assert not any(query.startswith("site cpsc.gov") for query in build_query_variants(req))
    assert domain_allowed("https://www.cpsc.gov/Recalls/2026/Goal-Zero-Recalls-YETI-3000X", req)
    assert not domain_allowed("https://www.cpsc.gov/Newsroom/Goal-Zero", req)
    assert not domain_allowed("https://www.goalzero.com/pages/yeti-3000x", req)


def test_advanced_search_fans_out_to_individual_engines():
    req = SearchRequest(
        query="OpenAI API pricing",
        search_depth="advanced",
        engines=["bing", "google"],
    )
    tasks = build_search_tasks(req)
    assert ("OpenAI API pricing", ["bing"]) in tasks
    assert ("OpenAI API pricing", ["google"]) in tasks
    assert ("OpenAI API pricing", ["bing", "google"]) not in tasks


def test_advanced_task_budget_covers_domain_variants(monkeypatch):
    monkeypatch.setattr(search_module.settings, "max_query_variants", 3)
    monkeypatch.setattr(search_module.settings, "max_advanced_tasks", 4)
    req = SearchRequest(
        query="API pricing",
        search_depth="advanced",
        include_domains=["openai.com", "anthropic.com"],
        engines=["yahoo", "yandex"],
    )
    tasks = build_search_tasks(req)
    assert len(tasks) == 4
    assert ("API pricing", ["yahoo"]) in tasks
    assert ("API pricing", ["yandex"]) in tasks
    assert any(query.startswith("site:openai.com ") for query, _ in tasks)
    assert any(query.startswith("site:anthropic.com ") for query, _ in tasks)


def test_numeric_mismatch_is_removed_from_final_ranking():
    req = SearchRequest(query="RTX 4090 price")
    group = [
        {"title": "RTX 5090 price", "url": "https://example.com/5090", "content": "RTX 5090 deal", "engines": ["yahoo"], "searx_score": 10.0},
        {"title": "RTX 4090 price", "url": "https://example.com/4090", "content": "RTX 4090 deal", "engines": ["yahoo"], "searx_score": 1.0},
    ]
    ranked = fuse_results([group], req)
    assert [item["url"] for item in ranked] == ["https://example.com/4090"]


def test_diversify_results_avoids_single_domain_takeover():
    ranked = [
        {"url": "https://a.example/1", "score": 0.99},
        {"url": "https://a.example/2", "score": 0.98},
        {"url": "https://a.example/3", "score": 0.97},
        {"url": "https://b.example/1", "score": 0.96},
        {"url": "https://c.example/1", "score": 0.95},
    ]
    chosen = diversify_results(ranked, limit=3, max_per_domain=2)
    assert [item["url"] for item in chosen] == [
        "https://a.example/1",
        "https://b.example/1",
        "https://c.example/1",
    ]


def test_run_search_tolerates_partial_backend_failure(monkeypatch):
    calls = 0

    async def fake_search(query, req, engines=None, client=None):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("temporary engine failure")
        return [{
            "title": "OpenAI API pricing",
            "url": "https://openai.com/api/pricing",
            "content": "OpenAI API pricing",
            "published_date": None,
            "engines": engines or ["bing"],
            "positions": [],
            "searx_score": 1.0,
            "_rank": 1,
            "_variant_query": query,
        }]

    monkeypatch.setattr(search_module, "search_searx", fake_search)
    req = SearchRequest(
        query="OpenAI API pricing",
        search_depth="advanced",
        engines=["bing", "google"],
        max_results=3,
    )
    results = asyncio.run(run_search(req))
    assert results
    assert results[0]["url"] == "https://openai.com/api/pricing"


def test_run_search_raises_when_all_backend_calls_fail(monkeypatch):
    async def always_fail(query, req, engines=None, client=None):
        raise RuntimeError("searxng unavailable")

    monkeypatch.setattr(search_module, "search_searx", always_fail)
    req = SearchRequest(query="test", search_depth="basic")

    try:
        asyncio.run(run_search(req))
    except SearchBackendError as exc:
        assert "all SearXNG search tasks failed" in str(exc)
    else:
        raise AssertionError("expected SearchBackendError")
