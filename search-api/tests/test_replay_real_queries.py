from scripts.replay_real_queries import build_request


def test_replay_request_preserves_observed_constraints():
    case = {
        "query": "portable power station recall North America",
        "search_mode": "news",
        "days": 30,
        "region": "North America",
        "max_results": 5,
    }
    request = build_request(case)
    assert request["topic"] == "news"
    assert request["days"] == 30
    assert request["country"] == "North America"
    assert request["max_results"] == 20
    assert request["include_raw_content"] is False
