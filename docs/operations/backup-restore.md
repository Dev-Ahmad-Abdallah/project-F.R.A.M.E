# Database Backup & Restore — Railway PostgreSQL

This document covers backup and disaster recovery procedures for Project F.R.A.M.E. PostgreSQL databases hosted on Railway.

## Overview

Project F.R.A.M.E. runs two PostgreSQL 16 instances:

| Service | Database | Purpose |
|---------|----------|---------|
| `postgres-a` | `frame_a` | Primary homeserver |
| `postgres-b` | `frame_b` | Federation peer homeserver |

Both databases share the same schema (managed via `services/homeserver/migrations/`).

---

## 1. Railway Built-in Backups

Railway automatically creates point-in-time backups for PostgreSQL services on paid plans.

### Viewing backups

1. Open the [Railway dashboard](https://railway.app/dashboard)
2. Select the project, then the PostgreSQL service
3. Navigate to **Settings > Backups**
4. Backups are listed with timestamps — click to download

### Restoring from Railway UI

1. In the PostgreSQL service settings, click **Backups**
2. Select the backup timestamp to restore from
3. Click **Restore** — this replaces the current database contents
4. Verify the application health after restore: `./scripts/healthcheck.sh homeserver`

> **Warning:** Restoring overwrites the current database. Consider exporting the current state first.

---

## 2. Manual Export (pg_dump)

For portable backups that can be restored anywhere (not just Railway).

### Prerequisites

- PostgreSQL client tools (`pg_dump`, `psql`) installed locally
- Database connection string from Railway dashboard: **Variables > DATABASE_URL**

### Export full database

```bash
# Get the DATABASE_URL from Railway dashboard or CLI
# Format: postgresql://user:password@host:port/dbname

# Full SQL dump (schema + data)
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file="frame_backup_$(date +%Y%m%d_%H%M%S).dump"

# Or as plain SQL (human-readable, larger file)
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --format=plain \
  --file="frame_backup_$(date +%Y%m%d_%H%M%S).sql"
```

### Export schema only (no data)

```bash
pg_dump "$DATABASE_URL" \
  --schema-only \
  --no-owner \
  --file="frame_schema_$(date +%Y%m%d_%H%M%S).sql"
```

### Export data only

```bash
pg_dump "$DATABASE_URL" \
  --data-only \
  --format=custom \
  --file="frame_data_$(date +%Y%m%d_%H%M%S).dump"
```

### Export specific tables

```bash
# Example: export only users and rooms tables
pg_dump "$DATABASE_URL" \
  --no-owner \
  --format=custom \
  --table=users \
  --table=rooms \
  --file="frame_partial_$(date +%Y%m%d_%H%M%S).dump"
```

---

## 3. Restore Procedures

### Restore to Railway (from custom dump)

```bash
# Get the target DATABASE_URL from Railway
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --dbname="$DATABASE_URL" \
  frame_backup_YYYYMMDD_HHMMSS.dump
```

### Restore to Railway (from plain SQL)

```bash
psql "$DATABASE_URL" < frame_backup_YYYYMMDD_HHMMSS.sql
```

### Restore to local development

```bash
# Start local PostgreSQL via docker-compose
docker-compose up -d postgres-a

# Restore into local database
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --dbname="postgresql://postgres:postgres@localhost:5432/frame_a" \
  frame_backup_YYYYMMDD_HHMMSS.dump
```

---

## 4. Using Railway CLI

The Railway CLI can proxy database connections for backup operations.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link to project
railway login
railway link

# Open a proxy to the database (runs in foreground)
railway connect postgres

# In another terminal, use the proxy connection string Railway prints
pg_dump "postgresql://..." --format=custom --file=backup.dump
```

---

## 5. Automated Backup Script

For scheduled backups, add a cron job or use a CI scheduled workflow.

### Local cron example

```bash
# Add to crontab (crontab -e) — daily at 2 AM UTC
0 2 * * * /path/to/project/scripts/backup-db.sh >> /var/log/frame-backup.log 2>&1
```

### Example backup script (`scripts/backup-db.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL environment variable}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

FILENAME="frame_backup_$(date +%Y%m%d_%H%M%S).dump"

echo "[$(date -u)] Starting backup..."
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file="${BACKUP_DIR}/${FILENAME}"

echo "[$(date -u)] Backup complete: ${FILENAME} ($(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1))"

# Clean up old backups
find "$BACKUP_DIR" -name "frame_backup_*.dump" -mtime +${RETENTION_DAYS} -delete
echo "[$(date -u)] Cleaned backups older than ${RETENTION_DAYS} days"
```

---

## 6. Disaster Recovery Checklist

If production goes down and data needs to be recovered:

1. **Assess the situation** — Is it a Railway outage, a bad deploy, or data corruption?
2. **Check Railway status** — https://status.railway.app
3. **If bad deploy** — Roll back via Railway dashboard (Deployments > select previous > Redeploy)
4. **If data corruption:**
   a. Stop the application (`railway down --service frame-homeserver`)
   b. Restore from the most recent Railway automatic backup (Section 1)
   c. If no automatic backup is available, restore from the latest manual dump (Section 3)
   d. Re-run migrations: `cd services/homeserver && npm run migrate`
   e. Restart the application and verify: `./scripts/healthcheck.sh`
5. **Verify federation** — Check that both homeservers can communicate
6. **Notify users** if there was data loss

---

## 7. Testing Backups

Periodically verify that backups can actually be restored:

```bash
# 1. Create a fresh local database
docker run --rm -d --name frame-restore-test \
  -e POSTGRES_DB=frame_restore_test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5499:5432 \
  postgres:16-alpine

# Wait for PostgreSQL to be ready
sleep 5

# 2. Restore the backup
pg_restore \
  --no-owner --no-privileges --clean --if-exists \
  --dbname="postgresql://postgres:postgres@localhost:5499/frame_restore_test" \
  backup.dump

# 3. Verify row counts
psql "postgresql://postgres:postgres@localhost:5499/frame_restore_test" \
  -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public';"

# 4. Clean up
docker stop frame-restore-test
```

Recommend testing backup restore at least once per month.
