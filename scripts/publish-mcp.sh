#!/usr/bin/env bash
# Publish @mojomo/mcp-server safely.
# Guards learned the hard way:
#   1. tarball must contain server.js AND tools.js
#   2. install the packed tarball and run a real MCP handshake before pushing
#   3. never PUT a partial versions map to the registry (it replaces, not merges)
set -euo pipefail
cd "$(dirname "$0")/../mcp-publish"

VERSION=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
echo "== publishing @mojomo/mcp-server@$VERSION =="

FILES=$(npm pack --dry-run 2>&1 | grep -oE '[a-zA-Z0-9._-]+\.js' | sort -u)
for f in server.js tools.js; do
  echo "$FILES" | grep -qx "$f" || { echo "FAIL: $f missing from tarball"; exit 1; }
done
echo "ok: tarball contains server.js + tools.js"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
npm pack --silent >/dev/null 2>&1
TGZ=$(ls -t ./*.tgz | head -1)
cp "$TGZ" "$TMP/"; rm -f ./*.tgz
cd "$TMP"
npm init -y >/dev/null 2>&1
npm install "./$(basename "$TGZ")" --silent >/dev/null 2>&1
OUT=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"guard","version":"1"}}}' \
  | timeout 20 node node_modules/@mojomo/mcp-server/server.js 2>/dev/null || true)
echo "$OUT" | grep -q '"name":"mojomo"' || { echo "FAIL: handshake failed"; echo "$OUT"; exit 1; }
echo "$OUT" | grep -q "\"version\":\"$VERSION\"" || { echo "FAIL: serverInfo version != $VERSION"; echo "$OUT"; exit 1; }
echo "ok: handshake + version $VERSION"

cd - >/dev/null
npm publish 2>&1 | tail -2
echo "== published $VERSION =="
