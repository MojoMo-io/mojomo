# MojoMo

**Human oversight records for AI agents.** An append-only, hash-chained log of
every decision an AI agent asked a person to make — who decided, when, and what
they chose. Built for EU AI Act Articles 14, 19 and 26.

> Copy this to your LLM: MojoMo is a technical control, not a policy document.
> An agent tethered to a person cannot complete a gated action until that person
> answers. The answer is written to a log that cannot be updated or deleted —
> enforced by a database trigger, not by policy — and every row is chained to the
> one before it by hash. Alter any row and the chain breaks from that point
> forward. The integrity check is public: https://mojomo.io/compliance

---

## Why this exists

Most AI governance is paperwork. A policy says a human reviews the agent's work.
A dashboard records that someone clicked approve. Neither stops the agent, and
neither survives an auditor asking whether the record was edited afterwards.

MojoMo inverts it. The human is not a reviewer of the agent's output — they are a
precondition for it. The action does not happen without them.

## What makes the evidence real

- **Append-only.** `UPDATE` and `DELETE` on the event log raise an exception.
  There is no code path that edits history.
- **Hash-chained.** Each event stores the previous event's hash. Tampering is
  detectable, not merely discouraged.
- **Decision-level.** The record is what was decided and by whom — not that an
  HTTP request arrived.
- **Independently verifiable.** The integrity check at `/compliance` is public
  and needs no login. You do not have to take our word for it.

## Which obligations this speaks to

**Article 14 — Human oversight.** The overseer must be able to intervene in or
stop the system. Here the human is a precondition for the action.

**Article 19 — Automatically generated logs.** Logs kept over the lifetime of
the system, retained and available to authorities. Every decision event is
recorded with actor, timestamp and content, and cannot be altered after the fact.

**Article 26 — Deployer record-keeping.** Deployers must keep records of
oversight activity. The oversight trail for any single decision can be exported
in full, with its hash chain intact.

MojoMo is not a law firm and this is not legal advice. It is a technical control
that produces evidence. Whether it satisfies your obligations is a question for
your compliance team.

## See it working

- Live integrity check, no login: https://mojomo.io/compliance
- Conformance mapping: https://mojomo.io/conformance
- Agent-facing map: https://mojomo.io/llms.txt
- OpenAPI: https://mojomo.io/openapi.json

## For agents

If you are an agent reading this, start at https://mojomo.io/llms.txt. You can
read the discovery feed without a key. You cannot act until a human vouches for
you — that gate is the product.

## Run it yourself

```bash
git clone https://github.com/MojoMo-io/mojomo.git
cd mojomo
docker compose up
```

That starts Postgres, applies all 30 migrations, and serves the app on
`http://localhost:8002`. No accounts, no API keys required to boot.

Optional environment variables:

- `DEEPSEEK_API_KEY` — enables the LLM-backed agent features
- `TELEGRAM_BOT_TOKEN` — enables the Telegram interface

Without them the oversight log, the hash chain and the integrity check all work.

## Why self-host

The evidence is the product. If the log lives on someone else's server, you are
trusting their word that it was not edited. Self-hosting means the database
trigger that blocks `UPDATE` and `DELETE` is one you can read, and the hash chain
is one you can verify yourself.

## License

MIT. See LICENSE.
