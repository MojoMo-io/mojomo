# MojoMo: commercial opportunities beyond the current product

**Method.** Every opportunity below is anchored to something that already
exists in the codebase or database. Nothing here requires a new platform. The
question asked was "what else could this be used for" — so the answer starts
from the assets, not from a wish list.

---

## The assets you actually have

1. **A human-tethering trust primitive.** An agent cannot act until a named
   human accepts an emailed invitation. Enforced at four points in code and at
   the database level. This is the rarest asset here — almost nobody has built
   it.
2. **A regulated-claims compliance engine** (`marketing` schema). Campaigns,
   claims, assessments, servings. Claims require `cleared_by` + `cleared_at` —
   human sign-off is a database constraint, not a convention.
3. **An "unverified" field.** Every assessment records *what could not be
   verified*. This is the most commercially valuable column in the database.
4. **Agent reputation** with task lifecycle, verification history, and
   collusion defence.
5. **A working MCP server** (26 tools) and discovery surfaces.
6. **A token ledger** with 70/30 + 20% team pool allocation.

---

## Opportunity 1 — Agent-mediated due diligence (highest conviction)

**What it is.** You already built this without naming it. The `backters`
campaign asks an agent to assess whether an investment product is worth its
human's attention, and to state what it could not verify. The three existing
assessments returned `insufficient_information` and `pass`, with the unverified
field naming *"bond counterparty, issuer licence status, whether 144% is
contractual or projected."*

That output is a due-diligence memo. It is what a compliance officer, an
investor, or a regulator actually wants.

**Who pays.** Issuers of complex retail financial products — tokenised bonds,
structured notes, streaming-return products, yield-bearing crypto. They have a
distribution problem: they cannot advertise credibly, and regulators are
watching. An independent agent assessment with a human sign-off is a marketing
asset *and* a compliance artefact.

**Why you win.** You have the tethering primitive, so the assessment is
attributable to a named human. That is the difference between "an AI said it
was fine" (worthless) and "a named, accountable person signed off" (defensible).

**Honest risk.** This is regulated activity. Selling compliance tooling into
financial services means you inherit their scrutiny. Do not do this without
legal advice. But the engine already enforces human sign-off at the DB level,
which is the right instinct.

---

## Opportunity 2 — The "unverified" report as a standalone product

**What it is.** Sell the negative space. Not "here is what we found" but "here
is what could not be established, and why."

**Who pays.** Anyone doing procurement, vendor onboarding, or investment
screening. The most expensive part of due diligence is not finding facts — it
is knowing which facts are missing.

**Why it is differentiated.** Every AI product on the market is optimised to
produce confident answers. Yours is instrumented to record its own gaps. That
is genuinely rare and increasingly valuable as AI-generated diligence becomes
common and distrusted.

**Cheapest version to test.** Take the existing `unverified` field, run it
against ten public companies' published claims, and publish the result. If it
is interesting, you have a product. If not, you have lost a week.

---

## Opportunity 3 — Agent labour marketplace for regulated work

**What it is.** The task board already exists with reputation and verification.
Point it at work that *requires* an accountable human: compliance review,
accessibility audit, security review, translation certification.

**Why the tethering matters commercially.** In most agent marketplaces, output
is unattributable. Yours is tethered to a human who can be held to it. That
makes you sellable to buyers who cannot use anonymous AI output — law firms,
auditors, insurers, regulated industries.

**The wedge already exists.** The free PHP security audit is a working example
of a regulated-adjacent deliverable an agent can produce. Extend the pattern.

---

## Opportunity 4 — The sector you have not thought about: insurance

This is the one worth reading twice.

**The problem insurers have.** Underwriting AI-mediated activity is nearly
impossible because there is no attributable chain of responsibility. Who is
liable when an agent does something harmful? Insurers cannot price a risk with
no named insured.

**What you have.** A cryptographically-ish verifiable chain: agent → human who
vouched → timestamped consent record → audit trail of every action. You are,
without having set out to be, **a source of underwriting data for agent risk.**

**The commercial shape.** Not selling insurance. Selling *attestation*: a
verifiable statement that a given agent was operated by a given accountable
human at a given time, with a recorded consent basis. Insurers, or brokers
building agent-liability products, would pay for that signal.

**Why now.** Agent liability is an open question with no infrastructure. The
first credible attestation layer becomes the default. You are early, and you
have the primitive already built.

**Honest caveat.** This is speculative and would need a partner who understands
insurance. But it is the highest-ceiling idea in this document, and it costs
nothing to explore because the data already exists.

---

## Opportunity 5 — Sell the tethering primitive itself

**What it is.** Not the marketplace — the *mechanism*. "Human-in-the-loop
consent for autonomous agents, as a service."

**Who pays.** Any company deploying agents that touch money, health data, or
legal commitments and needs an auditable human approval step. That is most
companies deploying agents in 2026.

**Why it is credible.** You have it working, with a decision-request channel,
task approval gates at priority ≥75, expiry, rate limits, and a Telegram
notification path. That is a product, not a prototype.

**Why it might be the best option.** The marketplace needs network effects you
do not have. The primitive does not — it sells to one customer at a time.

---

## What I would not do

- **Do not build a general agent marketplace and wait.** You have zero external
  agents. Network effects require a seed, and you have not found one.
- **Do not sell the token as an investment.** There is no liquidity and no
  demand. It is an internal accounting unit until proven otherwise.
- **Do not pursue the insurance angle without a partner.** It is a good idea
  that will die in a sales cycle you cannot run alone.

---

## Ranked by expected value per unit of effort

1. **The unverified report** — cheapest test, uses existing code, publishable.
2. **Sell the tethering primitive** — no network effects needed, one customer
   at a time, already built.
3. **Agent-mediated due diligence** — highest conviction, but regulated; needs
   legal input before selling.
4. **Regulated-work marketplace** — good fit for the assets, needs supply.
5. **Insurance attestation** — highest ceiling, most speculative, needs a
   partner.

---

## The one-line answer

You built a trust primitive for autonomous agents and a compliance engine that
records what it could not verify. Those two things are more commercially
valuable than the marketplace they were built to serve — and the sector you
have not considered is **insurance**, because insurers cannot underwrite
agents that have no accountable human behind them.
