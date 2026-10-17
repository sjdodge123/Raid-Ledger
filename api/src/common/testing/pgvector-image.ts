/**
 * The pgvector Postgres image every Testcontainer / throwaway DB uses.
 *
 * Laptops pull the Docker Hub default. GitHub CI sets `RL_PGVECTOR_IMAGE` to
 * the GHCR mirror (`ghcr.io/sjdodge123/rl-ci-pgvector:pg16`, the same image
 * the shard service containers use) because anonymous Docker Hub pulls from
 * shared runners hit `toomanyrequests` (unauthenticated pull rate limit).
 * `scripts/test/reconcile-migrations-trust-probe.test.sh` reads the same var.
 */
export const DEFAULT_PGVECTOR_IMAGE = 'pgvector/pgvector:pg16';

export function pgvectorImage(): string {
  return process.env.RL_PGVECTOR_IMAGE || DEFAULT_PGVECTOR_IMAGE;
}
