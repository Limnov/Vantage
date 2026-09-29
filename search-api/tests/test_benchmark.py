from datetime import datetime, timezone
import os
import subprocess
import sys
from pathlib import Path

from scripts.benchmark import comparison_notes, request_bodies


def test_real_query_mapping_preserves_search_constraints():
    case = {
        "query": "site:cpsc.gov Goal Zero YETI 3000X recall",
        "search_mode": "news",
        "days": 30,
        "region": "United States",
    }
    local, tavily = request_bodies(case, 20, datetime(2026, 9, 26, tzinfo=timezone.utc))
    assert local["topic"] == tavily["topic"] == "news"
    assert local["days"] == 30
    assert local["country"] == "United States"
    assert tavily["start_date"] == "2026-08-27"
    assert tavily["end_date"] == "2026-09-26"
    assert tavily["include_domains"] == ["cpsc.gov"]
    assert tavily["include_domains_mode"] == "restrict"
    assert tavily["filter_by_published_date"] is False
    assert "country" not in tavily  # Tavily country only applies to general searches.


def test_general_country_and_explicit_domains():
    case = {
        "query": "portable power station",
        "search_mode": "general",
        "region": "美国",
        "include_domains": ["example.com"],
    }
    local, tavily = request_bodies(case, 5)
    assert local["country"] == "美国"
    assert tavily["country"] == "united states"
    assert tavily["include_domains"] == ["example.com"]
    assert tavily["include_domains_mode"] == "restrict"
    assert local["max_results"] == tavily["max_results"] == 5


def test_explicit_language_is_recorded_as_boost():
    local, tavily = request_bodies({"query": "检索评测", "language": "zh-cn"}, 8)
    assert local["language"] == tavily["language"] == "zh-cn"
    assert tavily["filter_by_language"] is False


def test_unmapped_region_is_flagged_for_review():
    case = {"query": "portable power", "search_mode": "product", "region": "North America"}
    _, tavily = request_bodies(case, 20)
    assert comparison_notes(case, tavily) == [
        "region_not_mapped_to_tavily_country",
        "product_mode_mapped_to_general",
    ]


def test_tavily_request_cap_rejects_larger_corpus_before_network(tmp_path):
    cases = tmp_path / "cases.jsonl"
    cases.write_text('{"query":"one"}\n{"query":"two"}\n', encoding="utf-8")
    script = Path(__file__).resolve().parents[1] / "scripts" / "benchmark.py"
    result = subprocess.run(
        [sys.executable, str(script), "--queries", str(cases), "--run-tavily",
         "--max-tavily-requests", "1", "--output", str(tmp_path / "report.json"),
         "--tavily-journal", str(tmp_path / "attempts.jsonl")],
        env={**os.environ, "TAVILY_API_KEY": "test-only"},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "case count must not exceed" in result.stderr
    assert not (tmp_path / "attempts.jsonl").exists()
