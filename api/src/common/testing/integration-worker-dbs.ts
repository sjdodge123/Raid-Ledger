/**
 * ROK-2200 spike: one Postgres database per jest worker, so the integration
 * suite can run with `maxWorkers > 1` without two files truncating each
 * other's rows. Opt-in: `RL_INTEGRATION_WORKERS=<n>` (n >= 2). Unset or 1 =
 * today's single-worker, single-DB behaviour, unchanged.
 *
 * The jest globalSetup migrates the base DB once, then clones it per worker
 * with `CREATE DATABASE … TEMPLATE` (a file copy — no per-worker migrate).
 * Each worker picks its clone by `JEST_WORKER_ID` (1-based).
 */
import postgres from 'postgres';

/** Space-separated per-worker DB URLs, index = JEST_WORKER_ID - 1. */
export const WORKER_DB_URLS_ENV = 'RL_INTEGRATION_WORKER_DB_URLS';

/** Worker count requested for this run (1 when unset/invalid). */
export function requestedWorkers(): number {
  const n = Number(process.env.RL_INTEGRATION_WORKERS ?? '1');
  return Number.isInteger(n) && n > 1 ? n : 1;
}

/** `base` with its database name replaced by `name`. */
export function withDatabase(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Clone the (already migrated) base DB once per worker; returns the URLs. */
export async function cloneWorkerDbs(
  baseUrl: string,
  workers: number,
): Promise<string[]> {
  const baseName = new URL(baseUrl).pathname.replace(/^\//, '');
  const admin = postgres(withDatabase(baseUrl, 'postgres'), { max: 1 });
  const urls: string[] = [];
  try {
    for (let i = 1; i <= workers; i++) {
      const name = `${baseName}_w${i}`;
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${baseName}"`);
      urls.push(withDatabase(baseUrl, name));
    }
  } finally {
    await admin.end();
  }
  return urls;
}

/** This worker's DB URL, or undefined when per-worker mode is off. */
export function workerDbUrl(): string | undefined {
  const list = (process.env[WORKER_DB_URLS_ENV] ?? '').split(' ');
  const id = Number(process.env.JEST_WORKER_ID ?? '1');
  if (list.length < 2 || !Number.isInteger(id) || id < 1) return undefined;
  return list[id - 1] || undefined;
}
