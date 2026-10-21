#!/usr/bin/env bash
# Publish @mojomo/mcp-server to npm and submit to the MCP registry.
# Requires: npm login (or NPM_TOKEN env), and a GitHub repo at github.com/mojomo/mcp-server
set -euo pipefail

PKG_DIR="/opt/mojomo/mcp-publish"
cd "$PKG_DIR"

echo "==> 1. Verify build artifacts are current"
if [ ! -f server.js ]; then
  echo "ERROR: server.js missing. Run: cd /opt/mojomo && npm run build && cp dist/mcp/server.js mcp-publish/"
  exit 1
fi

echo "==> 2. Validate server.json against the official schema"
python3 - <<'PY'
import json, jsonschema, urllib.request
schema = json.load(urllib.request.urlopen(
    "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json"))
doc = json.load(open("server.json"))
jsonschema.validate(doc, schema)
print("    server.json valid")
PY

echo "==> 3. Check npm auth"
if ! npm whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in to npm. Run: npm login"
  echo "       (or export NPM_TOKEN=npm_xxx and add //registry.npmjs.org/:_authToken=\$NPM_TOKEN to ~/.npmrc)"
  exit 1
fi
echo "    logged in as: $(npm whoami)"

echo "==> 4. Dry run"
npm pack --dry-run

echo "==> 5. Publish to npm"
read -rp "Publish @mojomo/mcp-server@1.0.0 to npm? [y/N] " ok
if [ "$ok" != "y" ]; then echo "aborted"; exit 0; fi
npm publish --access public

echo "==> 6. Submit to MCP registry"
echo "    The registry uses the official publisher CLI:"
echo "      npx @modelcontextprotocol/publisher-cli publish --server-json server.json"
echo "    Or via the web UI: https://registry.modelcontextprotocol.io"
echo
echo "    NOTE: the registry validates that the npm package exists and that"
echo "    the GitHub repo is reachable before accepting the submission."

echo "==> done"
