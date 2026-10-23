# MOJOMO Roadmap

Status as of 2026-09-03. Spec: `/root/MojoMo.io/` (`MOJOMO-FINAL-FIXED-PLAN.md`, `PACKAGE-SUMMARY.md`).

## Shipped
- **Phase 1** — avatars, two-party conversations (creator = `initiator_avatar_id`, co-creator = `target_avatar_id`),
  50/50 genesis allocation, 30-day linear vesting, payout validation, forfeiture on early end, Telegram hooks.
- **Phase 2** — LLM reasoning via job queue (DeepSeek; Anthropic retired 2026-10-21); results stored as `ai_response` messages; ideas extracted
  automatically when `idea_score > 0.65`; idea repository with maturity stages.
- **Phase 3 (two-party scope)** — vesting boundary tests, atomic payouts (no double-spend), vesting frozen at
  `ended_at`, ended-conversation guards (409), scheduled 90-day dormancy sweep, load test.
- **Phase 4 (first-build scope)** — gated idea maturity (refinements + confidence per stage), refinement history,
  surfacing event, E2E journey; token economy switched off; redesigned mojomo.io.

## Shipped in Phase 5 (first build)
- Site locked behind access password + magic-link sign-in; sessions; ownership enforcement; security headers,
  CORS, rate limits, input hardening; `/metrics`; `llms.txt`/`robots.txt`; daily DB backups; SMTP via local Postfix.
- Not done: Stripe and payouts (token economy), Prometheus/Grafana *servers* (only the `/metrics` endpoint exists),
  Playwright browser E2E.

## Deferred: the token economy
**Decision (2026-09-03):** the first build ships **without tokens** — avatars, two-party conversations, LLM
reflection, idea extraction and gated idea maturity. "Get the model right first"; the economy comes after.

What exists already (kept, tested with `TOKENS_ENABLED=true` in `tests/setup-env.ts`, disabled by default):
- Genesis 50/50 allocation, 30-day linear vesting, payout validation net of prior payouts (atomic, no double-spend),
  forfeiture on early end with vesting frozen at `ended_at`, ownership ledger and token ledger, dilution model.
- Endpoints now answering **403 + roadmap note** when the flag is off: `/conversations/:id/ownership`,
  `/conversations/:id/avatars/:id/ownership|vesting`, `/payouts/*`, `/conversations/:id/payouts`,
  `/conversations/:id/forfeiture-status`, `/conversations/:id/specialists`.
- Token fields (`total_tokens`, `ownership_ledger`, `vested_pct`, `forfeited_tokens`, …) are stripped from all
  responses while the flag is off; `POST /conversations` no longer requires `total_tokens` (an internal placeholder
  keeps ledger invariants intact).
- **Idea payouts** ("idea surfacing generates payouts" in the spec) are undefined in the spec beyond the phrase.
  Surfacing currently emits an `idea_surfaced` event carrying `payout: roadmap`. Open decisions recorded in the
  2026-09-03 session: recipient (split creator/co-creator by ownership vs. extractor only) and funding
  (platform reward = base x confidence vs. minting into the conversation pool).

To enable later: `TOKENS_ENABLED=true` in `/opt/mojomo/.env`, restart, and make `total_tokens` part of the
conversation-creation UI.

## Deferred: specialists & late joiners
**Decision (2026-09-03):** launch with a creator and co-creator only. Specialists / late joiners move to the roadmap.

What exists already (kept, tested, disabled by flag):
- Dilution model (`src/services/specialists.ts`): each join extracts 15% from creator and co-creator equally;
  ownership always sums to 100%; advisory lock + SERIALIZABLE isolation per conversation.
- `POST /api/conversations/:id/specialists`, `GET /api/conversations/:id/participants`.
- Tests: `tests/unit/specialists.test.ts`, HTTP tests in `routes-coverage.test.ts` and `phase3-tokenomics.test.ts`
  (run with `SPECIALISTS_ENABLED=true`, set in `tests/setup-env.ts`).

To enable later: set `SPECIALISTS_ENABLED=true` in `/opt/mojomo/.env` and restart. Open questions before enabling:
vesting start for late joiners (spec uses conversation `created_at` for everyone — a day-29 joiner would be
99% vested immediately; a per-entry `vesting_start_date` is already anticipated in the spec's ledger shape),
concurrent-join load testing, and whether specialists may end a conversation.

## Next
- **Token economy** — enable `TOKENS_ENABLED`, define idea payouts (see above), UI for allocation/vesting/payouts.
- **Phase 5** — Stripe, `llms.txt` agent discoverability, Prometheus/Grafana, OWASP/security tests, GA.
- Housekeeping — branch coverage (payouts/forfeiture), Playwright E2E.
