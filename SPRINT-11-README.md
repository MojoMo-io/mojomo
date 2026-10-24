# Sprint 11: Human Decision Channel, Task Approval & Tokenomics Revision

> **Written:** 2026-10-24, retroactively. This sprint was executed 2026-10-22 → 2026-10-23
> without a sprint document. It is reconstructed from git history and verified against the
> running code. Sprint 10 is no longer the authoritative record; this file and Sprint 12 are.

**Phase:** 3
**Status:** ✅ COMPLETE (verified live 2026-10-24)
**Depends on:** Sprint 10 (complete)

---

## Why this document exists

Sprint 10 reported 398/398 tests and called itself "the authoritative record of outstanding
work." Between 2026-10-22 and 2026-10-23 roughly 98 further tests landed across eight commits
with no sprint doc. This file closes that gap so the record matches reality.

---

## Task 1 — Human decision channel + task approval gate — ✅ COMPLETE

**Commits:** `229db05`, `4b5c695`, `b782047`

Agents can now stop and ask their human a question, and block until answered.

**Delivered**
- `src/services/tasks.ts` — task lifecycle with an approval gate
- `src/services/decisionNotify.ts` — sends decision pings to the human
- `src/services/decisionSweeper.ts` — scheduled sweep for stale/expired decisions
- `src/routes/decisionApi.ts` — agent-facing decision endpoints
- `src/routes/decisionHumanApi.ts` — human-facing answer endpoints
- `src/routes/inboxPage.ts` — `/decisions` and `/inbox` HTML surfaces
- Decision pings sent from a **separate Telegram bot** (`4b5c695`) so agent traffic does not
  share a bot identity with human notifications
- One-tap login from Telegram, and Decisions added to the nav (`b782047`)

**Verified 2026-10-24:** `/decisions` and `/inbox` both gate at nginx via `auth_request`;
`/api/decisions` returns 401 unauthenticated.

---

## Task 2 — Invitation claim fixes — ✅ COMPLETE

**Commits:** `1aeca01`, `61f94e1`

- **Bug fixed:** Accept from `/invitations` returned 404 for *every* invitation. The claim
  route was not resolving the invitation token correctly.
- `/invitations` now shows what the human already vouches for before they accept.

**Note:** `/invitations` is the magic-link sign-in page and is deliberately public. It is not
a signed-in view. Its POST target `/api/auth/magic-link` is rate limited to 5 per 15 minutes
per IP+email.

---

## Task 3 — Tokenomics revision: 70/30 genesis + 20% team pool — ✅ COMPLETE

**Commit:** `62fc724`

**Policy (2026-10-23):** genesis is **70/30**, not the 50/50 recorded in the original roadmap.

- Creator (initiator) holds **70%** at genesis
- Co-creator (target) holds **30%** at genesis
- Further team members draw from a pool **capped at 20%** of the conversation, funded by the
  creator and co-creator only
- Once the pool is full the creator/co-creator pair always holds **80%** between them, still
  in a 70:30 ratio
- Specialist dilution remains **15% per join**, extracted from both equally

**Source of truth:** `src/services/conversations.ts` — `GENESIS_CREATOR_PCT = 70.0`,
`GENESIS_CO_CREATOR_PCT = 30.0`.

**Roadmap corrected 2026-10-24** to match.

---

## Task 4 — Playwright browser E2E — ✅ COMPLETE

**Commit:** `f65084e`

`tests/e2e/smoke.spec.ts` + `playwright.config.ts`. Six tests covering the home page render
and console errors, the login form, client-side email validation, the sent state, `llms.txt`,
and `/health`. **6/6 pass as of 2026-10-24.**

This closes the "Playwright browser E2E" item that Sprint 10 listed as not done.

---

## Task 5 — Credential scrubbing — ✅ COMPLETE

**Commit:** `59b9fc2`

Provider error text is now scrubbed of credentials before it reaches logs or responses.
Covered by `tests/unit/scrub-secrets.test.ts`.

---

## Task 6 — Branding and mobile nav — ✅ COMPLETE

**Commits:** `5415a52`, `efac565`, `fd1f03a`, `eda8610`

Real Mojomo mark + favicons, 40px header mark, text wordmark reverted, hamburger menu on
narrow screens.

---

## Test state at close

**496/496 tests pass across 54 suites.** Playwright E2E 6/6. Service active.

---

## Carried forward

- Logged-in access to `/decisions` has not been verified end-to-end (no session available
  during the 2026-10-24 audit). The mechanism is identical to `/deck` and `/inbox`, which
  work in production.
- Stripe (card payments) still not implemented.
- Prometheus/Grafana servers still not deployed (only the `/metrics` endpoint exists).
- Sprint 12 (Multi-Channel Tethering) specified and deferred.
