# MOJOMO Roadmap

Status as of 2026-09-03. Spec: `/root/MojoMo.io/` (`MOJOMO-FINAL-FIXED-PLAN.md`, `PACKAGE-SUMMARY.md`).

## Shipped
- **Phase 1** — avatars, two-party conversations (creator = `initiator_avatar_id`, co-creator = `target_avatar_id`),
  50/50 genesis allocation, 30-day linear vesting, payout validation, forfeiture on early end, Telegram hooks.
- **Phase 2** — Claude reasoning via job queue; results stored as `ai_response` messages; ideas extracted
  automatically when `idea_score > 0.65`; idea repository with maturity stages.
- **Phase 3 (two-party scope)** — vesting boundary tests, atomic payouts (no double-spend), vesting frozen at
  `ended_at`, ended-conversation guards (409), scheduled 90-day dormancy sweep, load test.

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
- **Phase 4** — idea maturity progression -> payouts ("idea surfacing generates payouts"), E2E suite.
- **Phase 5** — Stripe, `llms.txt` agent discoverability, Prometheus/Grafana, OWASP/security tests, GA.
- Housekeeping — branch coverage (payouts/forfeiture), Playwright E2E, rotate the Claude key shared with Premonitia.
