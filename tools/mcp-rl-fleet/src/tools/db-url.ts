// rl_db_url — get psql + pgweb URLs for an env's Postgres.
export const TOOL_NAME = 'rl_db_url';
export const TOOL_DESCRIPTION =
  "Get connection URLs for a test env's Postgres database. Returns the psql command to run inline (via docker exec on the VM) and an optional pgweb URL if pgweb is running for the slug. Use this when an agent needs to inspect/seed data in a running env without spinning up additional infrastructure.";

export interface DbUrlParams {
  slug: string;
}

export interface DbUrlResult {
  ok: boolean;
  slug: string;
  pg_container: string;
  psql_exec_cmd: string;
  database_url: string;
  pgweb_url: string;
  notes: string[];
}

export async function execute(params: DbUrlParams): Promise<DbUrlResult> {
  // Pure metadata — no remote call needed. The orchestrator names PG
  // containers deterministically: rl-env-{slug}-pg. Inside the rl-net
  // network, container DNS resolves rl-env-{slug}-pg:5432 to the Postgres.
  // The pgweb hostname is launched on demand by `rl db <slug> --web` (we
  // surface the URL here so it's discoverable; if pgweb isn't running yet,
  // the user can start it with that command from the operator shell).
  return {
    ok: true,
    slug: params.slug,
    pg_container: `rl-env-${params.slug}-pg`,
    psql_exec_cmd: `ssh rl-infra docker exec -it rl-env-${params.slug}-pg psql -U user -d raid_ledger`,
    database_url: `postgresql://user:password@rl-env-${params.slug}-pg:5432/raid_ledger`,
    pgweb_url: `http://db-${params.slug}.rl.lan`,
    notes: [
      "database_url uses container-network DNS — only valid from inside rl-net (e.g. testcontainers in the runner, the allinone container itself).",
      "pgweb_url only resolves if you've started it via `rl db {slug} --web` from the operator shell.",
      'For direct psql, the psql_exec_cmd opens an interactive prompt on the VM. Run it from a terminal.',
    ],
  };
}
