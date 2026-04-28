-- ROK-1156: Enable pg_stat_statements so the slow-query digest cron can read
-- per-statement metrics. Requires shared_preload_libraries=pg_stat_statements
-- to be set in the postgres command (see Dockerfile.allinone supervisor block
-- and docker-compose db service command override). pg_stat_statements is a
-- trusted extension since Postgres 13, so the raid_ledger app role can install
-- it directly without superuser intervention.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
