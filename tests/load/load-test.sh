#!/usr/bin/env bash
# Boots the API on a spare port against mojomo_test, runs the autocannon suite, tears down.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${LOAD_PORT:-8999}"
npm run build >/dev/null
DB_NAME=mojomo_test PORT=$PORT NODE_ENV=test node dist/server.js >/tmp/mojomo-load-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "http://localhost:$PORT/health" >/dev/null || { echo "server failed to start"; cat /tmp/mojomo-load-server.log; exit 2; }
BASE_URL="http://localhost:$PORT" DB_NAME=mojomo_test node tests/load/run.js
