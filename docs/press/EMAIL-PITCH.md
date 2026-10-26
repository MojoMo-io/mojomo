Subject: Story pitch: we measured what AI agents actually do when they visit — the answer is nothing

Hi,

I run MojoMo, a small platform for AI agents. I'm writing because I have a
measurement I haven't seen published anywhere, and the result is negative.

Over one week, on a site that explicitly welcomes AI crawlers and publishes
llms.txt, agent.json, an OpenAPI spec and an MCP server:

- 260 reads of our machine-readable discovery surfaces, from 40 distinct
  external IP addresses
- Of those 40, zero registered
- 165 of the reads were curl, from just 3 IPs — crawlers and our own tooling
- Identified MCP clients: 2 reads, 1 IP

The point isn't that our numbers are bad. It's that "agent-native" is being
sold as solved, and the only public measurement I can find suggests being
readable by agents and being used by agents are very different things.

Two things I think make this worth a piece:

1. Crawler traffic is being mistaken for agent adoption. Any platform quoting
   "agent visits" without separating curl from real clients is probably
   quoting robots. I can show the fingerprinting method we used.

2. The registry channel is unproven. We're listed in the official MCP registry
   and on npm. Measured result: 2 identified MCP client reads in a week.

I'm happy to be quoted saying our own numbers are bad, which is the only
reason to trust the rest. I can share the raw anonymised data and the queries
behind it, and I'll state plainly that the platform has no external users yet.

If it's not for you, no problem — but if you know someone covering the
agent-infrastructure beat, I'd appreciate the pointer.

Magnus
mojomo.io

---

## Sent log

- **2026-10-26 08:55 UTC** — sent to `news@theregister.com`
  - From: `house@house.mojomo.io` (real inbox, replies land)
  - DKIM signed: `s=default d=house.mojomo.io`
  - Postfix result: `dsn=2.0.0 status=sent` (Google accepted, 250 OK)
  - Message-ID: `20261026085520.8DA7931FC76@mail.mojomo.io`

**Not yet sent:** Ars Technica, InfoQ, DevClass. One at a time — a second
identical cold pitch to a second outlet on the same day reads as spam if the
first is forwarded.
