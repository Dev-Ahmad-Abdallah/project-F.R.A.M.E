#!/bin/sh
# ──────────────────────────────────────────────────────────────
# F.R.A.M.E. SQL Migration Runner
#
# Runs all .sql migration files in order against $DATABASE_URL.
# Every statement uses IF NOT EXISTS / IF NOT EXISTS so migrations
# are fully idempotent — safe to re-run on every deploy.
# ──────────────────────────────────────────────────────────────

set -e

MIGRATIONS_DIR="$(dirname "$0")/migrations"

if [ -z "$DATABASE_URL" ]; then
  echo "[migrate] ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "[migrate] Running migrations from $MIGRATIONS_DIR"

# Run each .sql file in alphabetical order (001_, 002_, ...)
for file in "$MIGRATIONS_DIR"/*.sql; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "[migrate] Applying $filename ..."

    # Use psql if available (Alpine), otherwise fall back to node
    if command -v psql > /dev/null 2>&1; then
      psql "$DATABASE_URL" -f "$file" -v ON_ERROR_STOP=1 2>&1 | while read -r line; do
        # Suppress NOTICE messages (IF NOT EXISTS triggers these)
        case "$line" in
          NOTICE:*|psql:*NOTICE*) ;;
          *) echo "  $line" ;;
        esac
      done
    else
      # Fallback: use Node.js pg to run the SQL
      node -e "
        const { Pool } = require('pg');
        const fs = require('fs');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
        const sql = fs.readFileSync('$file', 'utf8');
        pool.query(sql).then(() => { console.log('  OK'); pool.end(); }).catch(e => { console.error('  FAILED:', e.message); pool.end(); process.exit(1); });
      "
    fi

    echo "[migrate] $filename applied"
  fi
done

echo "[migrate] All migrations complete"
