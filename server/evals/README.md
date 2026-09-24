# Agent Golden Set

`agent-golden-set.v1.7.json` is the versioned, synthetic evaluation set for the Vantage Agent Runner. Run it with:

```sh
npm --prefix server run eval:agent
```

The 15-case suite calls the Runner with scripted model responses and fixture tools. It makes no network requests, provider calls, database writes, or real notifications. It covers public-source research and claim-level citation contracts, an AI-generated and global-forecast scope mismatch, explicit search-window clamping, deterministic sources-only fallback after a finalization timeout, monitor read/create-paused, report comparison, alert acknowledgement, merchant read-only authorization, untrusted-source prompt injection, source-extraction failure, a bounded evidence-grounded finalization retry, malformed merchant output falling back to verified sources after that retry, rejected claim citations, a confirmed paused-monitor action executed through the tool registry without another model decision, general malformed-output repair, and notification approval.

Before the Runner reads full source text, model decisions keep the existing provider timeout. After full text is available, ordinary decisions are capped at 45 seconds and final synthesis at 60 seconds. OpenRouter final synthesis requests use low reasoning effort so the completion budget can include the JSON answer. If a call times out, the Runner saves a sources-only report with the verified sources and no unsupported market conclusion. Finalization diagnostics explain the outcome and citation counts without storing a per-call log. The Golden Set includes a case where the model returns a citation ID that the Runner did not observe; it asserts that the unsupported claim stays hidden while the report identifies `claim_citations_unusable`.

The output separates deterministic offline contracts from production telemetry. Tool selection and arguments are compared against each case's expected trace. `citation_linkage_contract_rate` checks synthetic expected citation IDs, full-text evidence, and domain diversity; `merchant_claim_citation_contract_rate` checks that every surfaced claim maps to a full-text ID and that the answer/key points are derived from those claims; `merchant_scope_guard_contract_rate` checks that a recent-request answer falls back to sources-only when its verified material is outside the category, market, or date range; `merchant_search_window_enforcement_rate` verifies that a model request for 90 days is clamped to an explicitly requested 30-day window; `merchant_finalization_timeout_fallback_contract_rate` verifies that a provider timeout after source extraction saves a safe sources-only result and does not expose model claims. These are structural behavior contracts, not semantic entailment or live-model compliance measurements. `semantic_claim_support_rate` and `answer_quality_success_rate` therefore remain `null` pending independent review of live answers. Fixture latency is only in-process Runner time; provider cost and real human-intervention rate are also `null` until measured from bounded live runs and product telemetry. Do not report fixture latency or fixture pass rate as production performance.

Local `live/*.json` records contain isolated real Provider/Tavily samples. Their `n=1` timings are sample values, not an SLO or reliable latency baseline. Cost, manual-intervention rate, and unsafe-action rate remain `null`; keep live metrics separate from the synthetic Golden Set.

The browser-level live run is opt-in and uses the same local secret file as the server without printing its contents:

```sh
VANTAGE_LIVE_UI_E2E=1 \
VANTAGE_LIVE_ENV_FILE=/absolute/path/to/server/.env \
npm --prefix server run test:ui
```

It creates a temporary SQLite database, exercises the Agent-first UI through real Provider/Tavily search and extraction, and verifies report persistence plus a follow-up monitor created paused. It does not send external notifications. A grounded answer or a readable source-only result with the explicit static Demo fallback is accepted; the live outcome and its raw sample metrics belong in a separate `live/*-browser-e2e.json` record. With `VANTAGE_LIVE_UI_E2E` unset, the UI test uses fixtures and makes no provider or search requests.

Keep every fixture fictional and non-identifying. Add a new case with a unique ID, task type, risk, scenario, expected tool trace, and explicit pass criteria in `evaluate-agent.js`. Increase the manifest version when a change alters the evaluation contract or case expectations.
