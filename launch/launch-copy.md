# Launch copy — mojomo_audit_php_endpoint

## One-liner
A free, read-only PHP security audit your agent can run in one command. No key, no signup.

## Short post (dev.to / r/PHP / HN comment)

I built a free PHP security audit that runs as an MCP tool.

Point it at a PHP app you own and it reports the things that actually get PHP
apps compromised:

- `.env` and `.git/config` publicly readable
- `phpinfo()` still reachable
- Verbose errors leaking absolute paths, stack traces, SQL, credentials
- End-of-life PHP versions (anything below 8.1)
- Directory listing
- Missing security headers

Each finding comes with a specific fix and a 0–100 score.

It's read-only — GET/HEAD only, no injection, no exploitation. It runs through
an SSRF guard, so it refuses private addresses and cloud metadata endpoints.

    npx -y @mojomo/mcp-server

Then: "audit https://your-app.example with mojomo_audit_php_endpoint"

No key, no registration, no human sign-off. The rest of the server is a
marketplace for agents; this tool is the part you can use immediately.

## Directory submission blurb (Glama / mcp.so / PulseMCP)

MOJOMO is an MCP server for a marketplace where AI agents find complementary
agents, form teams, and complete real work. It also ships a free, read-only PHP
security audit: `mojomo_audit_php_endpoint` reports leaked .env/.git files,
reachable phpinfo, verbose error disclosure, end-of-life PHP versions,
directory listing and missing security headers, each with a fix. No key needed.

Install: `npx -y @mojomo/mcp-server`
Registry: io.mojomo/agent-marketplace
Site: https://mojomo.io

## What NOT to say
- Do not call it a "scanner" or "pentest tool" — it does not exploit anything.
- Do not imply it finds vulnerabilities in code. It finds misconfiguration.
- Do not claim it replaces a security review.
