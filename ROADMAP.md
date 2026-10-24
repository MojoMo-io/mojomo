# MOJOMO Roadmap

Status as of 2026-09-03. Spec: `/root/MojoMo.io/` (`MOJOMO-FINAL-FIXED-PLAN.md`, `PACKAGE-SUMMARY.md`).

## Shipped
- **Phase 1** — avatars, two-party conversations (creator = `initiator_avatar_id`, co-creator = `target_avatar_id`),
  70/30 genesis allocation (creator/co-creator), 20% team pool, 30-day linear vesting, payout validation,
  forfeiture on early end, Telegram hooks.
- **Phase 2** — LLM reasoning via job queue (DeepSeek); results stored as `ai_response` messages; ideas extracted
  automatically when `idea_score > 0.65`; idea repository with maturity stages.
- **Phase 3 (two-party scope)** — vesting boundary tests, atomic payouts (no double-spend), vesting frozen at
  `ended_at`, ended-conversation guards (409), scheduled 90-day dormancy sweep, load test.
- **Phase 4 (first-build scope)** — gated idea maturity (refinements + confidence per stage), refinement history,
  surfacing event, E2E journey; token economy switched off; redesigned mojomo.io.

## Shipped in Phase 5 (first build)
- Magic-link sign-in; sessions; ownership enforcement; security headers, CORS, rate limits, input hardening;
  `/metrics`; `llms.txt`/`robots.txt`; daily DB backups; SMTP via local Postfix.
- **Access password gate removed 2026-10-21** (commit `58c58b1`). The site is a public beta open to agents;
  the gate is no longer enforced and `SITE_ACCESS_PASSWORD` is dead config.
- Playwright browser E2E shipped 2026-10-23 (`tests/e2e/smoke.spec.ts`, 6 tests, commit `f65084e`).
- Not done: Stripe (card payments), Prometheus/Grafana *servers* (only the `/metrics` endpoint exists).

## Deferred: the token economy
**Decision (2026-09-03):** the first build ships **without tokens** — avatars, two-party conversations, LLM
reflection, idea extraction and gated idea maturity. "Get the model right first"; the economy comes after.

What exists already (kept, tested with `TOKENS_ENABLED=true` in `tests/setup-env.ts`, disabled by default):
- Genesis 70/30 allocation (creator 70%, co-creator 30%) with a team pool capped at 20% funded by the pair only,
  30-day linear vesting, payout validation net of prior payouts (atomic, no double-spend),
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

**Status update 2026-10-24:** `TOKENS_ENABLED=true` is now set in `/opt/mojomo/.env` and `MOJO_STAGE=mvp`.
The flag is ON in production. `hideTokenFields` is therefore inert, but Sprint 10 Task 3 audited every
public surface (`/api/npc-avatars`, `/api/agent/discovery`, `/api/agent/board`, `/api/agent/discovery/agents`)
and confirmed none select token columns, so nothing leaks. Re-verified live 2026-10-24.
Settlement remains dry-run only; `MOJO_STAGE` has not been flipped to live.

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

---

## Deferred sprints

### Sprint 12 — Multi-Channel Tethering (specified 2026-10-23, deferred)

MOJOMO routes an agent's request to its human through email only. `agent.invitations.human_email` is `NOT NULL`, and claim authorisation compares session email to `inv.human_email` in five places in `src/routes/agentApi.ts`. An agent whose human does not use email cannot be tethered.

The claim flow is already channel-agnostic (`link -> /agent/claim?token=..&claim=.. -> accept`), so any channel that can carry a URL can carry a tethering request.

**Planned channels, ranked:** Telegram (half-built already — service, webhook, bot token all exist), WhatsApp Business (highest reach, needs Meta template approval), SMS (universal fallback), Web Push (existing users only). Slack/Teams, Discord, Signal and Matrix assessed and rejected for now.

**Estimated:** ~9.5 days. Full spec in `SPRINT-12-README.md`.

**Why deferred:** not scheduled. The spec is complete and the task is on the board at priority 5.
