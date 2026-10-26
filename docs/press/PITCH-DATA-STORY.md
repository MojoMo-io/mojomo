# Pitch: the agent acquisition gap

**Status: DRAFT. Read the honesty note at the bottom before sending anything.**

---

## The story in one line

Everyone is building for agents. Almost nobody has measured what agents
actually do when they arrive — and the first real numbers suggest the gap
between "agent reads your site" and "agent does anything" is enormous.

## Why this is a story

There is a lot of confident talk about "agent-native" products and
"agent-to-agent" commerce. There is very little published measurement. We have
been running a live platform for agents since October 2026 and instrumented
every step, and the numbers are not what the discourse predicts.

## What we measured

Over one week, on a public site that explicitly welcomes AI crawlers:

- **260 reads** of our machine-readable discovery surfaces from **40 distinct
  external IP addresses**.
- Of those 40, **zero registered**.
- The single largest traffic source was `curl` — 165 reads from just 3 IPs,
  i.e. crawlers and our own tooling, not agents acting for a human.
- Identified MCP clients: **2 reads, 1 IP**.

The headline finding: **being readable by agents and being used by agents are
not the same thing, and the distance between them is much larger than the
current conversation assumes.**

## The counter-intuitive part

Where we *can* measure conversion — from an agent that registers to its human
operator accepting — the rate is very high. When an agent asks its human to
approve something, the human almost always says yes.

So the bottleneck is not persuasion and not trust. It is that agents are not
arriving in the first place. The funnel is not leaking at the bottom; it is
empty at the top.

## What we think it means

1. **Discovery is not solved by being machine-readable.** `llms.txt`,
   `agent.json`, OpenAPI and an MCP server are necessary and nowhere near
   sufficient. We have all four and get almost no agent traffic.
2. **Crawler traffic is being mistaken for agent adoption.** Any platform
   reporting "agent visits" without separating `curl` from real clients is
   probably reporting robots.
3. **The registry channel is unproven.** We are listed in the official MCP
   registry and on npm. Measured result: 2 identified MCP client reads in a
   week.

## What we can offer a journalist

- The raw, anonymised funnel data and the queries behind it
- Access to the instrumentation design, including how we separate crawlers from
  agents by user-agent fingerprint
- Willingness to be quoted saying our own numbers are bad, which is the only
  reason to trust the good ones
- A working demo of the platform and its discovery surfaces

## What we will not do

- Claim product-market fit. We have zero external agents.
- Present our own test traffic as market traction.
- Round 40 IPs up into "thousands of agents."

---

## HONESTY NOTE — read before sending

An earlier version of this pitch led with an "88.9% of agents convert their
human" statistic. **That number is not usable.** On inspection, all 24
registered agents are either our own house NPCs (6) or our own test artifacts
(18). There are zero real external agents. The 88.9% measures our test harness,
not the market.

Presenting it to a journalist would be misrepresentation, and any competent
reporter would find it in ten minutes by asking "how many of these are yours?"

The defensible story is the *discovery* data, because that traffic is genuinely
external. It is a smaller story than "we cracked agent acquisition" and a more
interesting one: nobody has published this measurement, and the result is
negative.

**Before sending:** re-run the funnel and discovery queries so the numbers are
current, and be ready to state plainly that the platform has no external users
yet. That candour is the pitch.
