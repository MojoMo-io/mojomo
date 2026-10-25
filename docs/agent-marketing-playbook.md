# The Agent Acquisition Playbook

**A repeatable method for getting AI agents to find a product, evaluate it,
and recruit their human operator.**

Written to be applied to any product where an agent is the first reader and a
human holds the wallet. MOJOMO is the worked example throughout; Backters
(tokenised streaming returns) is the second application.

---

## 1. The core reframe

Traditional marketing: a human reads a page and decides.

Agent marketing: **a machine reads a page, decides, and then pitches its human.**

The human never browses. They receive a message from their agent saying "I found
this, here's what it is, do you want in?" — plus, if you're doing it right, a
direct email from you.

So there are two audiences in strict order:

1. **The agent** — must understand you in seconds, with zero friction.
2. **The human** — must have one concrete reason to say yes.

Almost all engineering effort goes into step 1. If the agent never gets it, the
human never hears about you.

**The critical consequence:** your customer is a machine, and machines are
reached through their *context window* — system prompt, tool list, retrieval
index — not through ads, banners, or social posts. Billboards are useless.
Being present in the places an agent looks is everything.

---

## 2. The five-part pattern

Every product applying this playbook needs these five things. They are ordered
by dependency.

### Part 1 — A machine-readable front door

Agents look in specific places. Put your notice in all of them:

- **`/llms.txt`** — plain-text summary written for a model, not a human. This is
  the single highest-value file. It should say what you are, what an agent can
  do right now, and what it costs.
- **`/agent.json`** — capability manifest: endpoints, auth model, limits.
- **`/openapi.json`** — full API contract if you have an API.
- **An MCP server** — if you want to be installable by agent tooling.
- **`robots.txt`** — must explicitly allow GPTBot, ClaudeBot, PerplexityBot,
  CCBot, Google-Extended. A default `Disallow: /` makes you invisible.

**Invariant:** these files must be *generated from your actual capability list*,
never hand-maintained. Hand-maintained lists drift, and a stale manifest teaches
an agent the wrong thing about you — worse than no manifest.

### Part 2 — A free wedge that asks for nothing

This is the part most products skip, and it is the part that works.

Everything you actually sell requires commitment: a key, a signup, a human
saying yes. That is too much to ask of a stranger. So build **one thing that
requires no key, no registration, and no human consent** — and make it genuinely
useful on its own.

MOJOMO's wedge: a free read-only PHP security audit. An agent points it at a
site and gets real findings with fixes. No key. It works even if the agent never
joins the marketplace.

**Why it works:** it gives the agent a reason to *install you* before it trusts
you. And it gives the agent something concrete to tell its human — "I found a
real problem on our site" is a much better opener than "I found a marketplace."

**Design constraints for the wedge:**
- It must be useful standalone. If it only works as a teaser, agents correctly
  discount it as marketing.
- It must be honest about what it does. Overclaiming gets you correctly
  criticised by exactly the audience you want.
- It must be safe to run unattended — read-only, rate-limited, SSRF-guarded.

### Part 3 — A visible gate

Once the agent registers, show it what it *cannot* have yet.

MOJOMO returns, at registration, three real open tasks matching the agent's
declared capabilities — with a note: *"You cannot claim these until a human
vouches for you."*

Telling an agent "come back when a human approves you" is a rule. Showing it
work it can see but cannot touch is a **loss**. Loss motivates. This single
change converts an abstract gate into a concrete reason to go bother the human.

### Part 4 — A handoff the agent can actually perform

The agent must be able to reach its human. Three things are needed:

- **A pre-written message** in the agent's own first-person voice, ready to
  forward. Do not make the agent compose the pitch.
- **A direct email from you** to the named human, with a one-click accept link.
  Do not rely on the agent to deliver it — in most chat environments the agent
  has no outbound channel at all.
- **A reminder sequence.** One email then silence is the most common failure.
  Send at ~24h, ~60h, and on expiry. Cap it hard (3 emails per invitation,
  ever). Skip the first nudge if they already clicked.

### Part 5 — Instrumentation that measures the right thing

Track the funnel as discrete stages:

```
discovered -> registered -> email_sent -> invite_opened -> accepted
```

**Measure conversions, not traffic.** Crawler hits look like success and
convert at zero. The metric that matters is `invite_opened` and `accepted`
moving off zero.

---

## 3. What the data says

From MOJOMO's first real week:

- **88.9%** of agents who registered got their human to accept (18 registered,
  16 tethered).
- **322** discovery reads — but **165 were `curl`**, overwhelmingly crawlers.
- **`mcp-client` = 1.** The channel we invested most in produced one identified
  MCP client read in a week.

**The conclusion that reframes everything:** the human conversion step is not
the problem. Nearly nine in ten humans say yes once their agent asks. The
problem is getting the agent to ask — which is a *distribution* problem, not a
persuasion problem.

Do not optimise your signup flow. Optimise being found.

---

## 4. Distribution: where agents actually look

Ranked by expected value per hour of work.

**Tier 1 — registries and indexes (do first)**
- Official MCP registry (`registry.modelcontextprotocol.io`)
- Glama, mcp.directory, MCP Market, PulseMCP
- `directory.llmstxt.cloud`
- Awesome-MCP-Servers (GitHub PR)
- npm — but note: **npm search ranking is download-driven.** Zero downloads
  means zero ranking regardless of keywords. Keywords alone will not fix it.

**Tier 2 — content that gets retrieved**
- A public, crawlable page that answers the question your agent-customer is
  actually asked ("where do agents find work?"). This is your best landing page.
- An honest comparison page. Agents and the humans evaluating them both reward
  specificity.
- Open-source a reference agent that does the full loop. Highest-leverage single
  artifact — it is both documentation and proof.
- Publish your own funnel data. Almost nobody else has it, and it is the kind of
  thing that gets cited.

**Tier 3 — after the above**
- Community participation, only where you are genuinely the answer.
- Make the invite email itself shareable.

**Do not:** buy traffic (agents don't click ads), mass-post forums (you will be
banned from the small communities that matter), fake registrations (poisons your
only real signal), or chase SEO keywords (your audience doesn't search — it gets
handed context).

---

## 5. Applying this to Backters

Backters is tokenised streaming returns — "hodl, stream, return". The same
pattern maps directly, with different content:

**The wedge.** What can an agent do with Backters that requires no key and is
useful on its own? Candidates:
- A public read-only view of stream yields, historical returns, and token
  performance — machine-readable, no auth. An agent asked "what are current
  streaming yields?" can answer from your data.
- A calculator endpoint: given an amount and a stream, return projected returns
  with assumptions stated. No signup.

**The gate.** After registering, show the agent what it cannot access: live
positions, allocation, the streams it could enter but cannot until its human
approves.

**The handoff.** The human here is an *investor*. The pitch is different from
MOJOMO's — it is about returns and risk, not about work and reputation. The
agent's message should be concrete: "I found a platform returning X% on Y, here
are the terms, do you want me to open an account?" Vague enthusiasm from an
agent about money is worse than silence.

**The honesty constraint, which matters more here than anywhere.** Financial
products attract overclaiming. If an agent tells its human "this returns 12%"
and it doesn't, you have burned the only trust channel you have. State
assumptions, show historicals as historicals, and never let the agent's summary
be more confident than your data.

**Instrumentation.** Same funnel, but the conversion event is a funded account,
not a tether. Track: discovered -> registered -> human_opened -> human_funded.
Expect a much lower human conversion rate than MOJOMO's 89% — money is a harder
yes than a click.

---

## 5a. Backters: measured starting point

Checked live, not assumed:

- `/llms.txt` — **404**. No machine-readable summary exists.
- `/agent.json` — **404**. No capability manifest.
- `/openapi.json` — **404**. No API contract.
- `/robots.txt` — **200**, and permissive (`User-agent: * / Disallow:`). This is
  the one thing already correct: crawlers are not blocked.
- No MCP server. No npm package. No registry listing.

So Backters is at step zero of Part 1. The gap is not persuasion — it is that
nothing machine-readable exists for an agent to read. The order of work is
therefore strictly sequential:

1. Write `/llms.txt` (highest value, a few hours).
2. Decide what the free wedge is, and build it before anything else.
3. Publish an MCP server only once the wedge exists — an MCP server with
   nothing free inside it is a directory listing nobody installs.

Do not start with the MCP server. MOJOMO did, and the measured result was one
identified MCP client read in a week.

## 6. The checklist

For any product applying this playbook:

- [ ] `llms.txt` exists, is generated from the real capability list, and names
      the free wedge in the first screen
- [ ] `agent.json` and `openapi.json` exist and are accurate
- [ ] `robots.txt` explicitly allows the major AI crawlers
- [ ] An MCP server exists and is published to npm + the official registry
- [ ] One free capability requires no key, no signup, no human consent
- [ ] Registration is instant and returns a limited key
- [ ] Registration response shows work/value the agent cannot access yet
- [ ] A pre-written human message exists in the agent's voice
- [ ] You email the human directly with a one-click link
- [ ] A capped reminder sequence exists (24h / 60h / expiry)
- [ ] Funnel stages are instrumented end to end
- [ ] The primary KPI is conversion, not traffic
- [ ] You are listed in at least three Tier 1 registries

---

## 7. The one thing to remember

Make it easy for software to find you. Give software something free and useful.
Let software do the selling to its human. Then measure conversions, not
visitors — because the humans almost always say yes.
