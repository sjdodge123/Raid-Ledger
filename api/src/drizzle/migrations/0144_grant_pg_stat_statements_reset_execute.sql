-- ROK-1333: Grant EXECUTE on pg_stat_statements_reset() to the raid_ledger app
-- role so the hourly slow-query digest (ROK-1273, slow-queries.service.ts:64)
-- can clear cumulative counters without a permission error.
--
-- Empirically verified (2026-05-23, PG 16): the pg_read_all_stats built-in role
-- does NOT confer EXECUTE on pg_stat_statements_reset in PG 16 — the function's
-- default ACL is `postgres=X/postgres` and only superusers can call it. The
-- narrower per-function grant is the only path that works without making
-- raid_ledger a superuser.
--
-- The function signature is pg_stat_statements_reset(oid, oid, bigint) since
-- pg_stat_statements 1.7+ (Postgres 14+). Older signatures (e.g. the no-arg
-- form in 1.6) are not relevant here — the extension installed on prod /
-- dev / Testcontainers is the current contrib version.
--
-- Idempotent + environment-tolerant:
--   - undefined_object: the raid_ledger role does NOT exist (test environments
--     using POSTGRES_USER=test, ephemeral Testcontainers, etc.). Skip silently.
--   - undefined_function: pg_stat_statements is not installed yet (the
--     extension migration 0131 runs first, so this should not happen in
--     practice, but the guard keeps the migration safe under unusual init
--     orders such as a partial restore that skipped 0131).
--   - insufficient_privilege: caller is not a superuser. Migration runner is
--     usually superuser; this branch exists only for hardened deploys where
--     migrations run under a lower-privileged role.
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION pg_stat_statements_reset(oid, oid, bigint) TO raid_ledger;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'role "raid_ledger" not present; skipping pg_stat_statements_reset grant';
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_stat_statements_reset() not present; skipping grant';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'migration runner lacks privilege to grant EXECUTE; skipping';
END
$$;
