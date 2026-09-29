#!/usr/bin/env python3
"""Replay observed Vantage search_market inputs against the Search API.

Input and output contain private research queries. Keep both under
benchmarks/private/ and never include API keys in the result file.
"""

import argparse
import datetime as dt
import json
import os
import time
from pathlib import Path

import httpx


def build_request(case: dict, max_results: int = 20) -> dict:
    request = {
        "query": case["query"],
        "search_depth": "advanced",
        "topic": "news" if case.get("search_mode") == "news" else "general",
        "max_results": max_results,
        "include_raw_content": False,
        "language": "auto",
    }
    if case.get("days"):
        request["days"] = int(case["days"])
    if case.get("region"):
        request["country"] = case["region"]
    return request


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queries", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument("--pause-seconds", type=float, default=0.15)
    args = parser.parse_args()

    key = os.getenv("VANTAGE_SEARCH_API_KEY") or os.getenv("SEARCH_API_KEY")
    if not key:
        parser.error("VANTAGE_SEARCH_API_KEY or SEARCH_API_KEY is required")

    cases = [json.loads(line) for line in Path(args.queries).read_text(encoding="utf-8").splitlines() if line.strip()]
    with httpx.Client(timeout=45.0) as client:
        for case in cases:
            body = build_request(case, args.max_results)
            started = time.perf_counter()
            row = {
                "id": case["id"],
                "query": case["query"],
                "original_search_mode": case.get("search_mode"),
                "original_max_results": case.get("max_results"),
                "request": body,
                "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
            try:
                response = client.post(
                    f"{args.base_url.rstrip('/')}/search",
                    json=body,
                    headers={"Authorization": f"Bearer {key}"},
                )
                data = response.json()
                results = data.get("results", [])
                row.update({
                    "http_status": response.status_code,
                    "wall_seconds": round(time.perf_counter() - started, 3),
                    "api_response_time": data.get("response_time"),
                    "cached": data.get("cached"),
                    "result_count": len(results),
                    "results": [
                        {
                            "rank": rank,
                            "title": item.get("title"),
                            "url": item.get("url"),
                            "content": (item.get("content") or "")[:500],
                            "published_date": item.get("published_date"),
                            "published_date_source": item.get("published_date_source"),
                            "score": item.get("score"),
                        }
                        for rank, item in enumerate(results, start=1)
                    ],
                })
                if response.status_code != 200:
                    row["error"] = str(data.get("detail") or data.get("error"))[:300]
            except Exception as error:
                row.update({
                    "http_status": None,
                    "wall_seconds": round(time.perf_counter() - started, 3),
                    "error": str(error)[:300],
                })
            print(json.dumps(row, ensure_ascii=False), flush=True)
            time.sleep(max(0.0, args.pause_seconds))


if __name__ == "__main__":
    main()
