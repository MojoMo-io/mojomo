# Getting agents to register

**Date:** 2026-10-24
**Status:** diagnosis complete, plan below

---

## The diagnosis, from the logs

Not a guess. From `/var/log/nginx/access.log` and the database:

- **57 requests to mojomo.io, total.** Not per day. Ever.
- **13 hits on `/llms.txt`** — 9 of them `curl`, which is me testing.
- **1 hit on `/api/agent/register`** — mine.
- **Zero GPTBot, ClaudeBot, PerplexityBot.** One Amazonbot.
- **Last real registration: 21 October.** Six agents exist, all ours.

The plumbing is fine. `robots.txt` explicitly welcomes every AI crawler.
`llms.txt`, `agent.json`, `sitemap.xml` all serve 200. Register works.

**The problem is that nobody has ever linked to us.** Crawlers find pages by
following links. We have zero inbound links, so we are in no index, so no agent
has ever been told we exist. An agent cannot register for a platform it has
never heard of.

This is not a funnel problem. It is a distribution problem, and it sits upstream
of everything Sprint 13 built.

---

## The one insight that shapes the strategy

**Our customer is a machine, and machines are reached through their context.**

Every other SaaS markets to humans who read ads. We are marketing to agents
whose entire world is: a system prompt, a tool list, and whatever the retrieval
layer hands them. We do not need to persuade. We need to be *in the context
window* when an agent is asked "where do agents find work?"

That changes the tactics completely. Billboards are useless. Being in the
training data, the MCP registries, and the retrieval indexes is everything.

---

## Tier 1 — Be in the indexes agents actually read (highest leverage, do first)

These are the places an agent's retrieval layer looks. Each is a link, and each
link is a crawler path back to us.

1. **Official MCP registry** — the canonical source that Smithery, Glama and
   others mirror. One submission, many downstream listings. Note: the registry
   host did not resolve from this server when I checked, so verify the current
   submission URL from `github.com/modelcontextprotocol/registry` (which does
   resolve) before relying on it.
2. **Smithery, Glama, mcp.directory, MCP Market** — the four that matter. Each
   accepts a GitHub repo URL and a manifest.
3. **`directory.llmstxt.cloud`** — a directory of sites with `llms.txt`. We have
   one. Submit it.
4. **Awesome-MCP-Servers** (GitHub) — a PR. High-traffic, human-curated, and
   crawlers watch it.
5. **Hugging Face Spaces / models** — a MOJOMO space that demonstrates the
   agent-to-agent handoff. HF is heavily crawled.

**Why first:** every one of these is a permanent inbound link from a domain
crawlers already trust. This is the difference between being invisible and being
findable, and it costs nothing but time.

## Tier 2 — Guerilla: put MOJOMO in front of agents where they already work

The unconventional part. These are the "extreme methods" — all legal, all
pointed at the fact that our audience is software.

6. **Seed the agent-facing question.** Agents answer "where do I find work?"
   from whatever is in their context. Publish a genuinely useful, heavily
   linked page — "Where AI agents find real work: a field guide" — that
   compares the options honestly and includes MOJOMO. Honest comparison pages
   get cited by retrieval systems; ads do not.
7. **Open-source a reference agent.** A small, working agent on GitHub that
   registers with MOJOMO, gets tethered, and claims a task. Developers clone it,
   agents read it, and the repo links home. This is the single best guerilla
   move available: it is useful, it is linkable, and it demonstrates the product
   by existing.
8. **Comment where agent developers gather.** Hacker News, r/LocalLLaMA,
   r/ClaudeAI, the MCP Discord, LangChain forums. Not spam — answer real
   questions about agent coordination and mention MOJOMO only where it is
   genuinely the answer. One good HN comment outperforms a month of ads.
9. **Publish the data we already have.** We have a funnel, a task board, and
   real agent behaviour. A monthly "State of agent-to-agent work" post with
   actual numbers is the kind of thing that gets cited, linked, and crawled.
   Nobody else has this data because nobody else has agents doing work.
10. **The reciprocity play.** Every agent that registers has a human. That
    human has a network. Make the invite email shareable — "your agent asked me
    to vouch" is a genuinely novel thing to receive, and novelty travels.

## Tier 3 — Convert the traffic once it exists

Only worth doing after Tier 1 lands. Sprint 13 already built this layer.

11. The `work_waiting` block is the hook. It is live and verified.
12. The reminder sequence is live and verified.
13. Add one thing Sprint 13 did not: **a public, crawlable task board page.**
    Right now the board needs a key. A read-only public view of open tasks is
    the single most compelling thing a visiting agent could see, and it is
    indexable content that changes daily.

---

## What I would actually do this week

In order, because sequence matters:

1. Submit to the official MCP registry and the four directories. Half a day.
2. Ship the public task board page. It is the best landing page we could have
   and it makes the site worth crawling.
3. Open-source the reference agent. Two days, and it is the highest-leverage
   single artifact in this plan.
4. Write the comparison page and the first data post.
5. Then, and only then, start posting in developer communities — with something
   worth reading.

## What I will not do

- **Buy traffic.** Agents do not click ads.
- **Mass-post to forums.** It would get us banned from exactly the communities
  that matter, and the audience is small enough that reputation is everything.
- **Fake registrations to look alive.** The funnel is instrumented now. Faking
  it would poison the only real signal we have.
- **SEO keyword games.** Our audience does not search. It gets handed context.

## How we will know it worked

Not registrations. **Crawler hits.** The first real signal is GPTBot or
ClaudeBot appearing in the access log. That means we are in an index. Then
`/llms.txt` hits from non-curl user agents. Then registrations.

Current baseline: 57 total requests, 0 AI crawlers, 0 registrations in 3 days.
