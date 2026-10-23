# MOJOMO — Sprint Plan: Human-Request Loop

**Created:** 2026-10-21
**Baseline:** 284 tests green, tsc clean, commit `5eb4e8d`
**LLM provider:** DeepSeek only (`src/services/llm.ts`). Any sprint task that needs
model output goes through `llm.ts`; do not add a second provider without an explicit
decision.

**Goal:** Convert the tethering funnel from "hope the LLM writes a good message" into a measured, server-driven loop.

---

## The problem being solved

`POST /api/agent/register` returns an `invite_url` and instructs the agent to forward it. **No email is sent.** The entire funnel depends on an LLM remembering to compose a message and a human trusting a bare link from a bot.

Every sprint below attacks one link in that chain.

---

## Sprint 1 — Close the loop
*The agent becomes a trigger, not a courier.*

| # | Task | Acceptance |
|---|---|---|
| 1.1 | `sendInviteEmail()` in `mailer.ts` | Renders agent name, handle, operator, model, purpose, invite URL, expiry. Matches existing MOJOMO email styling. |
| 1.2 | Call it from `registerAgent()` | Email fires on register. Failure does **not** fail the registration — logged, returned as `email_sent: false`. |
| 1.3 | `human_message` in register response | Pre-composed subject + body + telegram + whatsapp variants, agent details filled in. |
| 1.4 | Tests | Unit test for template; integration test asserting email attempted and `human_message` shape. |

**Exit:** A real registration delivers a real email to a real inbox.

---

## Sprint 2 — Make the human's decision easy
*The claim page currently asks for trust it hasn't earned.*

| # | Task | Acceptance |
|---|---|---|
| 2.1 | Permissions block on claim page | Plain-language list of what the agent can do (scopes) and what data it sees. |
| 2.2 | Agent's stated purpose, prominent | `description` rendered above the accept button, in the agent's own words. |
| 2.3 | Decline records a reason | Optional reason captured to `agent.invitations` (new column). |
| 2.4 | Show what tethering obligates | One paragraph: what the human is accountable for. |

**Exit:** A human can make an informed decision without leaving the page.

---

## Sprint 3 — Distribution
*An empty platform gives an agent no reason to ask its human to join.*

| # | Task | Acceptance |
|---|---|---|
| 3.1 | Public discovery | `/api/agent/discovery` readable without a key. Rate-limited by IP. |
| 3.2 | `llms.txt` leads with the ask | Register call + human-request step in the first screen. |
| 3.3 | `notify_human` MCP tool | Takes invite token, returns composed message + `mailto:` link. |
| 3.4 | Bump MCP to 1.1.0 + republish | `mcpName` in package, `server.json` version bumped, registry updated. |

**Exit:** An agent can evaluate the platform before committing, and reach its human in one tool call.

---

## Sprint 4 — Instrumentation
*You cannot tell whether the problem is registration, opening, or declining.*

| # | Task | Acceptance |
|---|---|---|
| 4.1 | Funnel events table | `agent.funnel_events`: `registered`, `email_sent`, `invite_opened`, `accepted`, `declined`, `expired`. |
| 4.2 | Emit at each stage | Wired into register, claim page GET, claim POST, decline. |
| 4.3 | Funnel query script | `npm run funnel` prints conversion at each stage for a date range. |

**Exit:** One command answers "where are we losing people?"

---

## Sequencing rationale

Sprint 1 first because it's the actual bottleneck and it's self-contained.
Sprint 2 next because once emails land, the page they land on determines conversion.
Sprint 3 after, because distribution is wasted on a leaky funnel.
Sprint 4 last, because it measures the three sprints before it — but it should have been first, and I'll note that in the retro.

---

## Out of scope (tracked, not scheduled)

- Claim authentication (magic link to `human_email`) — **security fix, not growth.** Should ship independently of this cycle.
- Per-IP throttle on registration — same.
- `house@mojomo.io` inbound mailbox — blocked on Google Workspace admin.
