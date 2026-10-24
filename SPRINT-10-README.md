# Sprint 10: Settlement, Test Coverage & Public Surface Hardening

> **Written:** 2026-10-22. **SUPERSEDED 2026-10-24** — see `SPRINT-11-README.md`.
> This file is no longer the authoritative record. Work continued past it without a sprint
> doc (human decision channel, task approval gate, 70/30 tokenomics, Playwright E2E);
> Sprint 11 reconstructs that work. Read Sprint 11 and Sprint 12 first.
> Current architecture doc: `/root/mojomo/MOJOMO-NPC-SUPPORT-VERIFIED-2026-10-22.md`

**Phase:** 3
**Status:** ✅ ALL TASKS COMPLETE (2026-10-22). Task 5 added and complete.
**Depends on:** Sprint 9 (complete)

---

## Context — what is already done

Shipped 2026-10-22, verified against the live server:

- `GET /api/npc-avatars` — public, unauthenticated, 10 NPCs, prompt-leak guard
- Homepage section 04 "Meet the cast" (`web/index.html` → `/var/www/mojomo/index.html`)
- 5 NPC bios repaired (Atlas, Beacon, Cipher, Delta, Echo had system prompts in `bio`)
- Dashboard transcript viewer + ownership ledger view (`web-admin/admin.html`)
- `GET /api/admin/conversations` (new), messages endpoint joins avatar names
- `/llms.txt` and `/api/agent.json` both advertise `/api/npc-avatars`
- Fixed `jsonb -> uuid` crash in `/api/admin/avatars/:id/ledger`

398/398 tests pass. Service active.

---

## Objectives

Close the gap between "the economy computes" and "the economy pays out", and make sure
the endpoints settlement depends on are actually tested — a `jsonb -> uuid` bug shipped
today precisely because nothing exercised that route.

---

## Task 1 — Settlement service (DRY RUN ONLY) — ✅ COMPLETE

**Goal:** a settlement path that can be run safely, logs exactly what it would send, and
moves no money until explicitly enabled.

**Delivered:** `src/services/settlement.ts` + `POST /api/admin/settlement/run`.
7 tests in `tests/integration/sprint10-settlement.test.ts`. Live dry run verified:
`considered: 0, would_send_total: 0.00, ledger_only: true`.

**Acceptance criteria**
- [x] `src/services/settlement.ts` with `settlePayouts({ dryRun })`
- [x] Selects payouts where `status='pending'` AND the avatar's vested amount > 0
- [x] Computes vested amount via `calculateAvatarOwnershipAtTime` — never trusts a stored number
- [x] Resolves recipient address from the avatar's owning user's wallet
- [x] Skips (does not fail) payouts with no recipient address, logging why
- [x] Idempotency: a payout already carrying a `tx_hash` is never re-sent
- [x] `dryRun: true` logs `WOULD SEND <amount> MOJO to <addr> for payout <id>` and writes nothing
- [x] `dryRun: false` calls `sendMojo()`, sets `status='settled'`, `tx_hash`, `settled_at`
- [x] On send failure: `status='failed'`, error recorded, no partial state
- [x] **`MOJO_STAGE` is NOT changed by this sprint.** Settlement stays unreachable in production.

**Explicitly out of scope:** flipping `MOJO_STAGE` to live. That is a separate decision
requiring human sign-off after reviewing dry-run output.

---

## Task 2 — Test coverage for admin + public endpoints — ✅ COMPLETE

**Goal:** the routes added on 2026-10-22 have tests, so the next regression is caught.

**Acceptance criteria**
- [x] Test: `GET /api/npc-avatars` returns 200 without auth
- [x] Test: `GET /api/npc-avatars` never returns a `bio` starting with "You are"
- [x] Test: `GET /api/admin/conversations` returns 401 without a session
- [x] Test: `GET /api/admin/conversations` returns rows with `initiator_name`/`target_name`
- [x] Test: `GET /api/admin/conversations/:id/messages` joins `avatar_name`
- [x] Test: `GET /api/admin/avatars/:id/ledger` returns 200 with a valid session
      (this is the regression test for the `jsonb -> uuid` bug)
- [x] Test: ledger endpoint returns 401 without a session

---

## Task 3 — `hideTokenFields` decision — ✅ RESOLVED (documented, no code change)

**Goal:** resolve the contradiction between `TOKENS_ENABLED=true` and the middleware's intent.

**Finding:** `hideTokenFields` returns immediately when `tokensEnabled()` is true, so it
strips nothing. Token fields are public right now.

**Resolution (2026-10-22):** audited every public surface. `/api/npc-avatars`,
`/api/agent/discovery`, `/api/agent/board`, `/api/agent/discovery/agents` — none expose
`token_balance`, `ownership_pct`, `vested_pct`, or `buy_in_amount`. The middleware is
inert but the leak it was meant to prevent does not exist, because the public routes
never select those columns in the first place.

**Decision:** leave as-is. `hideTokenFields` is defence-in-depth that is currently
inactive; it becomes active automatically if `TOKENS_ENABLED` is ever turned off. No
code change. Revisit only if a public route starts selecting token columns.

- [x] Decide: token fields are not public on any current surface
- [x] Documented here
- [x] Verified by live audit of all four public endpoints

---

## Task 4 — Documentation sync — ✅ COMPLETE

- [x] Update `MOJOMO-NPC-SUPPORT-VERIFIED-2026-10-22.md` section 7 with final status
- [x] Note in `SPRINT-9-README.md` that Sprint 10 supersedes its settlement assumptions
- [x] Sprint 10 file is the authoritative record; mirrored to Vault

---

## Bonus fix found while testing

`requireAdmin` dereferenced `req.auth!.userId` without checking `req.auth` existed. If
mounted without `requireAuth` it returned 500 instead of 401. Now fails closed with 401.

## Task 5 — User wallet addresses — ✅ COMPLETE

**Why:** `payouts.recipient_address` existed but nothing recorded where a *user* wants to
be paid. Settlement had no way to resolve avatar -> address, so on-chain payouts could
never be addressed.

**Delivered**
- `migrations/2026-10-22-phase21-user-wallet-address.sql` — `mojomo.user_wallets`
  (user_id, chain, address, label, is_default). DB-level constraints: address must be
  lowercase `0x` + 40 hex; one row per (user, chain, address); **at most one default per
  (user, chain)** via partial unique index.
- `src/services/userWallets.ts` — list, add, setDefault, delete, and
  `resolveAvatarPayoutAddress(avatar_id, chain)`.
- `src/routes/userWallets.ts` — `GET/POST /api/wallets`, `POST /api/wallets/:id/default`,
  `DELETE /api/wallets/:id`. Mounted after `attachSession + requireAuth`; `user_id` comes
  from the session, never the body.
- `settlement.ts` now resolves the address from the avatar's owning user's default wallet
  when the payout row has none.
- 12 tests in `tests/integration/sprint10-user-wallets.test.ts`.

**Live verified:** added an address, confirmed it became default, confirmed settlement
dry run still reports `considered: 0` and moves nothing.

## Known blockers (not solvable in code)

1. **`MOJO_STAGE=mvp`** (MVP = Minimum Viable Product). Flipping to live is a human decision after dry-run review.
   Settlement is built and refuses to send in this state by design.

**Not a blocker:** token price and DEX liquidity. A token has no price until there is
demand; creating pairs is a market-maker's job, not the platform's. The economy runs on
the ledger, which is the source of truth. Settlement reads the ledger and stays
ledger-only until a counterparty exists. Do not treat "no market price" as a defect.

## Verification commands

```bash
systemctl is-active mojomo.service
npx jest --silent 2>&1 | grep -E "Tests:|Suites:"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8002/api/npc-avatars
sudo -u postgres psql -p 5433 -d mojomo -c "SELECT status, count(*) FROM mojomo.payouts GROUP BY status;"
```

## Rollback

Backups taken before every edit on 2026-10-22:
- `src/routes/agentApi.ts.bak.*`, `.bak2.*`
- `src/routes/admin.ts.bak.*`
- `web/index.html.bak.*`, `/var/www/mojomo/index.html.bak.*`
- `web-admin/admin.html.bak.*`
