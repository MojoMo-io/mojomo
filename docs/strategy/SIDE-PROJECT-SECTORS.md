# Side project: what else MojoMo could do

**The question.** What other commercial opportunities could MojoMo bond, and
which sector has not been considered?

**The method.** Start from the primitive, not from a wish list. Then find where
the law *requires* that primitive and nobody is selling it.

---

## The primitive, stated precisely

An agent cannot act until a named human accepts an emailed invitation. Every
consequential action then flows through a decision channel that records:

- who the human is (`tether_user_id`)
- what was asked (`kind`, `title`, `body`, `options`)
- what they answered (`answer`, `answer_note`, `answered_at`)
- when it expired (`expires_at`)
- whether they were notified (`notified_at`)
- rate limits, so the human is not trained to ignore the badge

That is **consent + attribution + audit**, in one mechanism, enforced at six
points in code and at the database level.

---

## The sector I had not considered: EU AI Act compliance

This is the answer to "a sector you haven't thought about."

### Why it is a real market, not a guess

The EU AI Act (Regulation 2024/1689) imposes, on high-risk AI systems:

- **Article 14 — Human oversight.** Oversight must be *built in before market
  placement*, must let the overseer understand limits, monitor for anomaly, and
  **override, disregard or stop** the system. The oversight person must have
  "the necessary competence, authority and resources."
- **Article 19 — Automated logs.** Automatic recording of events over the
  lifetime of the system.
- **Article 26 — Deployer obligations.** Deployers must assign qualified humans
  and **maintain records of oversight activity.**

Read those three together and you have: *a named human with authority, who can
stop the machine, and a record proving they were there.*

That is MojoMo's tethering primitive. Not an analogy — the same mechanism.

### The deadline is the sales trigger

**2 December 2027** for Annex III high-risk systems (extended from 2 August 2026
by the 2026 Digital Omnibus). Thirteen months out. Hard date, defined scope,
statutory obligation, and every affected company needs evidence they complied.

### The eight Annex III sectors

1. Biometrics — remote identification, categorisation by sensitive traits
2. Critical infrastructure — safety components in traffic, water, gas, grid
3. Education — admissions, assessment, exam monitoring
4. Employment — CV screening, promotion, termination, gig-work allocation,
   employee monitoring
5. Essential services — **credit scoring, insurance risk and pricing**, benefits
   eligibility, emergency dispatch
6. Law enforcement — recidivism risk, profiling, evidence reliability
7. Migration and border — asylum risk assessment, document verification
8. Justice and democratic processes — legal research, election influence, voting

**Sectors 3, 4 and 5 are the commercial ones.** Education, HR tech and
insurtech are crowded with vendors who already sell AI and now must bolt on
oversight records they do not have. Sectors 6, 7 and 8 are public sector — slow,
procurement-heavy, and the wrong place to start.

### Why MojoMo wins here specifically

Every competitor in AI governance sells **policy documents and dashboards**.
None of them sell an *enforcement mechanism*. A dashboard records that a human
was supposed to look. MojoMo makes the action impossible until a human actually
does.

That is the difference between "we have a human oversight policy" and "here is
the record of the human who authorised this specific decision, and here is proof
the system could not have proceeded without them."

### What actually exists today, verified

Being precise, because a compliance buyer will check:

- `agent.decision_requests` — 19 columns, full consent record. **0 rows.** The
  channel is built but has never been used in anger.
- `agent.tether_events` — 20 rows. Real.
- `agent.audit` — 145 rows, but it logs HTTP requests (`method`, `path`,
  `status`, `ip`), not decisions. That is **weaker than Article 19 requires**,
  which calls for automatic recording of events over the system's lifetime in a
  form that supports post-market monitoring.
- `agent.task_events` — 28 rows.

So the primitive is real and the schema is right, but the evidence trail is
thin and the consent channel is unexercised. Closing that gap is the first
engineering task if this direction is pursued.

### The honest risks

- **This is compliance software sold into legal departments.** Long sales
  cycles, procurement, security questionnaires. It is not a self-serve product.
- **Article 14 does not name a technical standard.** Conformity assessment is
  against harmonised standards, some still in development. You would be selling
  into ambiguity.
- **You would need to be credible.** A compliance buyer will ask who audited
  you. That is a real barrier for a one-person operation.
- **The deadline could slip again.** The Digital Omnibus already moved it once.

### The cheapest test

Do not build a product. Write a two-page mapping of Article 14(1), 14(4)(e),
19 and 26 against the existing `decision_requests` schema, showing field by
field how the current implementation satisfies or fails each clause. Publish it.
If compliance people engage with it, you have a market signal for the cost of a
week.

---

## The other sectors, ranked

### 1. Agent liability attestation (highest ceiling)

Insurers cannot underwrite AI-mediated activity because there is no attributable
chain of responsibility. MojoMo produces exactly that chain. Sell *attestation*,
not insurance: a verifiable statement that a given agent was operated by a given
accountable human at a given time, with a recorded consent basis.

Overlaps heavily with the AI Act play — the same records serve both. That
overlap is the reason to do it.

### 2. Due diligence with an "unverified" field

Already built and working (see Wellinvested). The `unverified` column is the
product: every AI tool is optimised to sound confident; this one records its own
gaps. Sell to procurement, vendor onboarding, investment screening.

### 3. Regulated-work marketplace

The task board already has reputation, verification and collusion defence.
Point it at work that *requires* an accountable human: compliance review,
accessibility audit, security review, certified translation.

### 4. Sell the tethering primitive as infrastructure

Not the marketplace — the mechanism. "Human-in-the-loop consent for autonomous
agents, as a service." Sells one customer at a time, needs no network effects.
This is the same product as the AI Act play, sold to a different buyer.

---

## What I would not do

- **Do not build a general agent marketplace and wait for network effects.** You
  have zero external agents. There is no seed.
- **Do not sell the token as an investment.** No liquidity, no demand.
- **Do not start with law enforcement, migration or justice.** Public sector,
  slow procurement, and the highest reputational risk.

---

## The one-line answer

The sector you have not considered is **EU AI Act compliance** — specifically
Articles 14, 19 and 26, which together mandate a named human with authority to
stop the system and a record proving they were there. That is your tethering
primitive, written into law, with a hard deadline of 2 December 2027 and eight
defined sectors. Everyone else is selling dashboards. You built the lock.
