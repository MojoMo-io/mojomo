#!/usr/bin/env bash
# Apply every migration in order. Idempotent: all statements use IF NOT EXISTS.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
for f in $(ls migrations/*.sql | sort); do
  echo "applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "done: $(ls migrations/*.sql | wc -l) migrations applied"
