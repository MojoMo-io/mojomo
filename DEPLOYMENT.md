# MOJOMO Production Deployment

**Deployed:** 2026-09-02  
**Server:** multiproject (185.132.38.167)  
**Status:** ✅ Live

## Service Configuration

### MOJOMO API (Port 8002)
- **Process Manager:** systemd (mojomo.service)
- **User:** root
- **Working Directory:** /opt/mojomo
- **Environment:** NODE_ENV=production
- **Auto-restart:** on failure (RestartSec=10)
- **Status:** `systemctl status mojomo`
- **Logs:** `journalctl -u mojomo -f`

### Database (PostgreSQL)
- **Host:** localhost
- **Port:** 5433 (note: not standard 5432)
- **Database:** mojomo
- **User:** postgres
- **Auth:** Unix socket with trust authentication
- **Schema:** 7 tables, all deployed
- **Backup:** Manual only (add cron job if needed)

### Nginx Reverse Proxy (Port 8081)
- **Domain:** mojomo.io / www.mojomo.io
- **Config:** /etc/nginx/sites-available/mojomo.io
- **Status:** enabled
- **Certificates:** /etc/letsencrypt/live/mojomo.io/ (valid)
- **Protocol:** HTTP (port 8081) - HTTPS config ready but testing only

## Environment Configuration

**Location:** `/opt/mojomo/.env`

```
NODE_ENV=production
PORT=8002
DATABASE_URL=postgresql://postgres@/mojomo?port=5433
DB_HOST=/var/run/postgresql
DB_PORT=5433
DB_NAME=mojomo
DB_USER=postgres
```

**Important:** .env is not version controlled. Update manually on server or via deployment script.

## Port Registry

| Service | Port | Protocol | Status |
|---------|------|----------|--------|
| MOJOMO API | 8002 | HTTP | LIVE |
| MOJOMO Proxy | 8081 | HTTP | LIVE |
| PostgreSQL | 5433 | Unix socket | LIVE |

## Health Checks

**Direct API:**
```bash
curl http://localhost:8002/health
# Expected: {"status":"healthy","timestamp":"..."}
```

**Via Nginx Proxy:**
```bash
curl -H "Host: mojomo.io" http://localhost:8081/health
# Expected: {"status":"healthy","timestamp":"..."}
```

## Common Operations

### Check Service Status
```bash
sudo systemctl status mojomo
```

### View Logs
```bash
# Live tail
sudo journalctl -u mojomo -f

# Last 50 lines
sudo journalctl -u mojomo -n 50
```

### Restart Service
```bash
sudo systemctl restart mojomo
```

### View Database
```bash
psql -U postgres -d mojomo -c "SELECT COUNT(*) FROM mojomo.avatars;"
```

### Check PostgreSQL Status
```bash
sudo systemctl status postgresql
```

## Deployment Checklist

- ✅ Allocate folder: `/opt/mojomo`
- ✅ Allocate ports: 8002 (API), 8081 (proxy), 5433 (PostgreSQL)
- ✅ Create `.env` with database credentials
- ✅ Deploy database schema (schema.sql)
- ✅ Create mojomo PostgreSQL role
- ✅ Configure pg_hba.conf for trust auth
- ✅ Create systemd unit (mojomo.service)
- ✅ Configure Nginx reverse proxy
- ✅ Install npm dependencies
- ✅ Build TypeScript project
- ✅ Start service and verify health
- ✅ Test API endpoints

## Known Issues & Limitations

1. **PostgreSQL Port 5433:** Not standard port (5432 was in use). Update .env if moved.
2. **Trust Authentication:** pg_hba.conf uses trust for local connections. Secure environment only.
3. **HTTPS:** Nginx config supports HTTPS but SSL redirect needs troubleshooting (testing on HTTP for now).
4. **Backups:** No automated backups configured. Add cron job before production cutover.

## Next Steps

1. **Automated Backups:** Set up daily PostgreSQL backups
   ```bash
   # Add to crontab:
   0 2 * * * /usr/bin/pg_dump -U postgres mojomo > /opt/backups/mojomo-$(date +\%Y\%m\%d).sql
   ```

2. **Monitoring:** Set up alerts for:
   - Service restart frequency
   - Disk space
   - Database size
   - API response times

3. **HTTPS:** Fix Nginx HTTPS config or use CloudFlare for SSL termination

4. **Rate Limiting:** Add Nginx rate limiting for production safety

5. **Logging:** Configure centralized logging (ELK, Datadog, etc.)

## Rollback Procedure

If issues occur:

```bash
# Stop service
sudo systemctl stop mojomo

# Check service status
sudo systemctl status mojomo

# View logs
sudo journalctl -u mojomo -n 100

# Restart
sudo systemctl start mojomo

# Verify health
curl http://localhost:8002/health
```

If database corruption:

```bash
# Export data (before dropping)
sudo -u postgres pg_dump -d mojomo > /tmp/mojomo-backup.sql

# Recreate schema
cd /opt/mojomo
sudo -u postgres psql -d mojomo -f schema.sql

# Restore if needed
sudo -u postgres psql -d mojomo < /tmp/mojomo-backup.sql
```

---

**Last Updated:** 2026-09-02  
**Deployed by:** Claude Haiku 4.5

## Test Database (added 2026-09-03)

Jest is pinned to a dedicated database via `tests/setup-env.ts` (`DB_NAME=mojomo_test`),
so the suite never writes to production. Recreate it from the canonical schema whenever
`schema.sql` changes:

```bash
sudo -u postgres psql -p 5433 -c "DROP DATABASE IF EXISTS mojomo_test"
sudo -u postgres psql -p 5433 -c "CREATE DATABASE mojomo_test"
sudo -u postgres psql -p 5433 -d mojomo_test -v ON_ERROR_STOP=1 -f schema.sql
```

`schema.sql` is verified to reproduce the production `mojomo` schema exactly (10 tables).

## History note

Master was reset on 2026-09-03 from the `v4.0` line (Sprints 10-18) back to Sprint 9.
Those sprints shipped services with no routes, no migrations, and placeholder tests, and
regressed the Phase 1 forfeiture authorization. They are preserved at tag
`archive/v4.0-unverified` and on the `phase-2/*`, `phase-3/*`, `phase-4/*` branches for salvage.

## Phase 2 (2026-09-03): reasoning → ideas pipeline

- `POST /api/conversations/:id/reasoning` only enqueues (201). The job queue in
  `src/services/job-queue.ts` is the single processor (5 s poll, 5 concurrent, 3 attempts).
- On completion `src/services/reasoning-outcome.ts` stores an `ai_response` message
  (attributed to the initiator), and if Claude's `idea_score` > 0.65 calls
  `extractIdeaFromMessage` (spec Sprint 5.1). Extraction failure never fails the job.
- All idea scores are 0..1 (`calculateIdeaScore`, API `idea_score`, `confidence_score`).
- Env: `CLAUDE_API_KEY` (required), `CLAUDE_MODEL` (default `claude-sonnet-5`),
  `CLAUDE_COST_INPUT_PER_MTOK` / `CLAUDE_COST_OUTPUT_PER_MTOK` (default 3 / 15).
- Load test (spec Layer 4): `npm run load-test` boots the API on :8999 against `mojomo_test`
  and asserts p50<100ms, p97.5<200ms, p99<500ms, errors<1% at 100 req/s.
- Coverage: `npx jest --coverage` (84% statements at Phase 2 close; spec ≥80%).

## Phase 3 (2026-09-03): two-party tokenomics hardening

- **Product decision:** conversations have a creator (`initiator_avatar_id`) and co-creator (`target_avatar_id`)
  only. Specialist joins are feature-flagged: `SPECIALISTS_ENABLED=true` re-enables `POST /conversations/:id/specialists`
  (default off -> 403). See ROADMAP.md.
- Payouts are atomic: `initiatePayout` locks the conversation row (`FOR UPDATE`), validates against vested minus
  already-paid tokens inside the same transaction, then inserts. Concurrent double-spend is impossible
  (tested with 5 and 20 racing requests). Vesting endpoint now reports `paid_out_tokens`; `available_tokens` is net.
- Vesting is frozen at `ended_at`: forfeited tokens never become withdrawable after a conversation ends.
- Ended conversations reject new messages, reasoning jobs, specialist joins and a second end with **409**.
- Dormancy sweep is scheduled in `server.ts` (`DORMANT_CHECK_INTERVAL_MS`, default 6h; `DORMANT_INACTIVITY_DAYS`,
  default 90; first run 60s after boot).
- DB pool: `DB_POOL_MAX` (default 20) and `DB_CONNECT_TIMEOUT_MS` (default 10000) so pool starvation fails fast.
  Ownership/vesting reads inside transactions reuse the transaction's client.
- Load test now includes the vesting read and the message write path.
