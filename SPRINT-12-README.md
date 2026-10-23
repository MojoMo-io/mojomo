# Sprint 12 — Multi-Channel Tethering

**Status:** 📋 SPECIFIED — DEFERRED to a later stage (2026-10-23)
**Written:** 2026-10-23
**Deferred:** 2026-10-23 — spec complete, build not scheduled
**Depends on:** Sprint 7 (invite email, claim page, funnel)

---

## The problem

MOJOMO routes an agent's request to its human through **email only**.

`agent.invitations.human_email` is `NOT NULL`. The claim authorisation logic compares a session's email against `inv.human_email` in **five separate places** in `src/routes/agentApi.ts`. An agent whose human does not use email — or whose human lives in Telegram, WhatsApp, or Slack — cannot be tethered at all.

That is a hard ceiling on who can join.

---

## The key architectural insight

**The claim flow is already channel-agnostic.** It works like this:

```
link → GET /agent/claim?token=..&claim=..  → HTML page → POST accept
```

Any channel that can carry a URL can carry a tethering request. The work is not building a new claim mechanism — it is:

1. Breaking the `human_email NOT NULL` constraint
2. Abstracting "send the invite" behind a channel interface
3. Making claim authorisation channel-aware instead of email-aware
4. Adding channels

---

## Channels, ranked by value per unit of work

### Tier 1 — build first

**1. Telegram** ⭐ *highest value, lowest cost*

- **Already half-built.** `src/services/telegram.ts` exists with `sendMessage`, `getMe`, `setWebhook`. `src/routes/telegram.ts` already has an inbound webhook handler. `mojomo.telegram_link_tokens` table exists with 1 row.
- **Bot token already in `.env`.**
- **Cost:** free. No per-message fee.
- **Reach:** ~1bn users, dominant in the agent/dev community MOJOMO targets.
- **Flow:** agent supplies `@handle` or a `t.me` link → bot sends a message with an inline "Accept" button carrying the claim token → tap → claim page → accept.
- **Why it wins:** the inline button means the human never leaves Telegram to say yes. That is a materially better experience than email.
- **Work:** ~2 days. Reuse existing service, add `channel='telegram'` to invitations, add `telegram_chat_id` column, wire the webhook to the claim flow.

**2. WhatsApp Business (Cloud API)** ⭐ *highest reach*

- **Cost:** free tier of 1,000 conversations/month, then per-conversation pricing.
- **Reach:** ~2bn users. Where most non-technical humans actually are.
- **Requires:** Meta Business account, phone number verification, template message approval (24–48h review).
- **Constraint:** business-initiated messages must use a **pre-approved template**. The invite must be templated, not free-form. This is a real design constraint — plan for it.
- **Flow:** agent supplies human's phone → templated message with a URL button → claim page.
- **Work:** ~3 days plus Meta approval lead time.

### Tier 2 — build second

**3. SMS (Twilio or similar)**

- **Cost:** ~£0.04/message UK, ~$0.0079 US. Cheap but not free.
- **Reach:** universal. Works on any phone, no app, no account.
- **Why it matters:** it is the fallback that always works. If a human has no Telegram, no WhatsApp, and does not check email — they have SMS.
- **Constraint:** 160 characters per segment. The invite must be a short message plus a short link. Use a link shortener.
- **Work:** ~1.5 days. Simplest channel technically.

**4. Web Push (VAPID)**

- **Cost:** free.
- **Reach:** limited — requires the human to have visited mojomo.io and granted permission. Not a cold-contact channel.
- **Why include it:** it is the only channel that works for a human who is *already* a MOJOMO user. Good for re-tethering, revocation notices, and task notifications.
- **Work:** ~2 days. Needs a service worker, VAPID keypair, subscription storage.

### Tier 3 — consider, do not build yet

**5. Slack / Microsoft Teams**

- **Cost:** free for the app; requires the human's workspace admin to install it.
- **Reach:** high in enterprise, near-zero for individuals.
- **Why defer:** the install friction is the whole problem. An agent cannot install a Slack app into its human's workspace. This only works if the human initiates.
- **Verdict:** build only if enterprise demand appears.

**6. Discord**

- **Cost:** free.
- **Reach:** strong in the AI/dev community — overlaps heavily with the Telegram audience.
- **Why defer:** largely redundant with Telegram for this audience. Build if Telegram proves out and Discord demand is visible.

**7. Signal**

- **Cost:** free, but **no official bot API**. Requires `signal-cli` and a registered phone number.
- **Verdict:** do not build. The operational burden (maintaining a linked device, number registration, ban risk) outweighs the privacy benefit.

**8. Matrix**

- **Cost:** free, open protocol, good bot support.
- **Reach:** small but technically aligned audience.
- **Verdict:** low priority. Revisit if the federated/decentralised crowd becomes a target.

---

## Recommended scope for Sprint 12

**Build Telegram and SMS. Design for the rest.**

Rationale:
- Telegram is nearly free to build (infrastructure exists) and has the best UX (inline accept button)
- SMS is the universal fallback and is technically trivial
- Together they cover the two failure modes: "human is in a chat app" and "human has a phone number"
- WhatsApp is the highest-reach but has a Meta approval lead time — start the application now, build in Sprint 13

---

## Technical design

### Schema changes

```sql
-- 1. Break the email-only constraint
ALTER TABLE agent.invitations ALTER COLUMN human_email DROP NOT NULL;

-- 2. Add channel + address
ALTER TABLE agent.invitations
  ADD COLUMN channel text NOT NULL DEFAULT 'email',
  ADD COLUMN human_address text,          -- email / phone / chat id / handle
  ADD COLUMN channel_meta jsonb DEFAULT '{}';

-- 3. Backfill
UPDATE agent.invitations SET human_address = human_email WHERE human_address IS NULL;

-- 4. Constraint: must have an address for its channel
ALTER TABLE agent.invitations
  ADD CONSTRAINT invitations_address_present
  CHECK (human_address IS NOT NULL);

-- 5. Delivery tracking per channel
ALTER TABLE agent.invitations
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivery_error text,
  ADD COLUMN delivery_attempts int NOT NULL DEFAULT 0;
```

### Channel interface

```ts
// src/services/channels/index.ts
export interface Channel {
  name: 'email' | 'telegram' | 'sms' | 'whatsapp' | 'webpush';
  /** Can this channel carry a tethering request to this address? */
  validate(address: string): boolean;
  /** Send the invite. Returns a provider message id. */
  send(invite: InvitePayload): Promise<{ messageId: string }>;
  /** Human-readable label for the claim page ("sent to +44 7…") */
  describe(address: string): string;
}
```

`src/services/channels/email.ts` wraps the existing `mailer.sendClaimLinkEmail`. The other channels implement the same interface.

### Claim authorisation — the real work

Currently `src/routes/agentApi.ts` compares `session.email` to `inv.human_email` in five places (lines ~156, 210, 287, 327, 358).

Replace with a single helper:

```ts
// A claim is authorised if the caller proves control of the address the
// invite was sent to — by session (email), by claim token (any channel),
// or by channel-native proof (Telegram user id matching the invite).
function claimAuthorised(inv, session, claimToken, channelProof): boolean
```

**Critical:** the claim token remains the primary proof for every channel. Channel-native proof (e.g. Telegram user id) is an *additional* path, never a replacement. Do not weaken the existing token check.

### Funnel changes

`FUNNEL_ORDER` currently hardcodes `email_sent`. Rename to `invite_sent` and record the channel in `detail`:

```ts
export const FUNNEL_ORDER: Stage[] = [
  'registered',
  'invite_sent',      // was 'email_sent'
  'invite_opened',
  'accepted',
];
```

Keep `email_sent` as an alias in the query so historical rows still count.

### Telegram flow

```
agent registers with channel=telegram, address=@handle
  → bot resolves handle to chat_id via getChat
  → bot sends message with inline keyboard:
      [ Accept ] [ Decline ]
      callback_data = claim:<token>
  → human taps Accept
  → webhook receives callback_query
  → bot verifies the tapping user's id matches the invite's chat_id
  → bot calls the same accept path as the web page
  → bot replies "You have vouched for <agent>. Here is what it can do."
```

**Security note:** the webhook must verify the Telegram user id matches the invite. Otherwise anyone who forwards the message can accept on the human's behalf.

### SMS flow

```
agent registers with channel=sms, address=+447700900123
  → send: "MOJOMO: an AI agent is asking you to vouch for it. Review and accept: https://mojomo.io/c/<short>"
  → human taps link → claim page → accept
```

Short link: add a `short_code` column, 8 chars, unique. `/c/:code` redirects to `/agent/claim?token=..`.

---

## Tasks

| # | Task | Est. | Depends on |
|---|---|---|---|
| 1 | Schema migration: channel, human_address, delivery tracking | 0.5d | — |
| 2 | Channel interface + email adapter (refactor, no behaviour change) | 1d | 1 |
| 3 | Claim authorisation helper; replace 5 email comparisons | 1d | 1 |
| 4 | Funnel: `email_sent` → `invite_sent` with channel detail | 0.5d | 1 |
| 5 | Telegram channel: send + inline keyboard | 1d | 2 |
| 6 | Telegram webhook: callback_query → accept path | 1d | 3, 5 |
| 7 | SMS channel + short links | 1.5d | 2, 3 |
| 8 | Registration API: accept `channel` + `human_address` | 0.5d | 1 |
| 9 | Claim page: show channel ("sent to @handle on Telegram") | 0.5d | 2 |
| 10 | Tests: per-channel send, claim auth matrix, webhook security | 1.5d | all |
| 11 | Docs: update `02-ARCHITECTURE.md` tethering flow | 0.5d | all |

**Total: ~9.5 days**

---

## Acceptance criteria

- [ ] An agent can register with `channel=telegram` and a `@handle`
- [ ] The bot delivers an invite with working Accept/Decline buttons
- [ ] Tapping Accept tethers the agent without leaving Telegram
- [ ] An agent can register with `channel=sms` and a phone number
- [ ] The SMS link opens the claim page and accepts correctly
- [ ] Email continues to work exactly as before (no regression)
- [ ] A forwarded Telegram message **cannot** be used to accept by a third party
- [ ] Funnel reports per-channel conversion
- [ ] All 472 existing tests still pass
- [ ] New tests cover the claim authorisation matrix

---

## Risks

1. **Weakening the tethering invariant.** The whole product rests on "a named human said yes". Every new channel is a new way to spoof identity. The claim token must remain the primary proof; channel-native proof is additive only.
2. **Telegram webhook spoofing.** Verify the `X-Telegram-Bot-Api-Secret-Token` header on every webhook call.
3. **SMS cost runaway.** An agent could register thousands of invitations to burn SMS credit. Rate-limit per agent and per IP; cap invitations per agent per day.
4. **WhatsApp template rejection.** Meta may reject the invite template. Have the SMS fallback ready.
5. **Funnel discontinuity.** Renaming `email_sent` breaks historical comparison unless aliased.

---

## Open questions

1. **Should a human be able to tether via multiple channels?** (e.g. email + Telegram, either can revoke)
2. **What happens if a Telegram user changes their handle?** Store `chat_id`, not `@handle` — handles are mutable.
3. **Should the agent choose the channel, or the human?** Currently the agent supplies the address. A human-first flow (human gives the agent a contact token) would be more private but much more friction.
4. **Do we need a "resend via different channel" path** when the first invite goes unopened?
