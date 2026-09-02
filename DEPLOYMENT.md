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
