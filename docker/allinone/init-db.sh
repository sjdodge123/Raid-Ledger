#!/bin/bash
set -e

# Initialize PostgreSQL if not already done
if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  echo "📦 Initializing PostgreSQL database..."
  /sbin/su-exec postgres initdb -D "${PGDATA}" --auth-local=trust --auth-host=trust > /dev/null 2>&1
  
  # Start PostgreSQL temporarily to create database (quiet LOG-level output)
  /sbin/su-exec postgres pg_ctl -D "${PGDATA}" -o "-k /run/postgresql -c log_min_messages=FATAL" -w start 2>/dev/null

  # Create user and database
  /sbin/su-exec postgres psql -q -c "CREATE USER raid_ledger WITH PASSWORD 'raid_ledger';"
  /sbin/su-exec postgres psql -q -c "CREATE DATABASE raid_ledger OWNER raid_ledger;"
  /sbin/su-exec postgres psql -q -c "GRANT ALL PRIVILEGES ON DATABASE raid_ledger TO raid_ledger;"

  # Enable pgvector extension (ROK-948) — requires superuser, must run before
  # Drizzle migrations create the vector-typed columns.
  /sbin/su-exec postgres psql -q -d raid_ledger -c "CREATE EXTENSION IF NOT EXISTS vector;"

  # Enable pg_stat_statements extension (ROK-1156) — requires superuser and a
  # postgres restart to take effect, but `pg_ctl stop` happens below so the
  # supervisor-managed restart picks up the shared_preload_libraries flag.
  /sbin/su-exec postgres psql -q -d raid_ledger -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"

  # Grant EXECUTE on pg_stat_statements_reset() to raid_ledger (ROK-1333) so
  # the hourly slow-query digest can clear cumulative counters. raid_ledger is
  # intentionally non-superuser (ROK-948 / ROK-1156); pg_read_all_stats alone
  # does NOT confer EXECUTE on this function in PG 16, so the per-function
  # grant is the only path that works.
  /sbin/su-exec postgres psql -q -d raid_ledger -c "GRANT EXECUTE ON FUNCTION pg_stat_statements_reset(oid, oid, bigint) TO raid_ledger;"

  # Stop PostgreSQL (supervisor will start it)
  /sbin/su-exec postgres pg_ctl -D "${PGDATA}" -m fast -w stop 2>/dev/null

  echo "✅ PostgreSQL initialized"
fi
