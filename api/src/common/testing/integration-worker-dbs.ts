/**
 * ROK-2200 / ROK-2206: one Postgres database per jest worker, so the
 * integration suite can run with `maxWorkers > 1` without two files
 * truncating each other's rows. Opt-in: `RL_INTEGRATION_WORKERS=<n>`
 * (n >= 2). Unset, 1 or invalid = today's single-worker, single-DB run.
 *
 * Per-worker mode never drops, migrates or truncates the base DB
 * (`DATABASE_URL` on CI). The jest globalSetup instead recreates a fresh
 * `<base>_tpl` DB, migrates it, then clones it once per worker with
 * `CREATE DATABASE … TEMPLATE` (a file copy — no per-worker migrate). A
 * fresh template each run means rows a previous run left behind (cron_jobs
 * and friends survive truncation) can never leak into the clones — the
 * spike's "dirty template" failure class. Each worker picks its clone by
 * `JEST_WORKER_ID` (1-based).
 */
import postgres from 'postgres';
import { runTestMigrations } from './integration-migrations';

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

/** The database name in a connection URL. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Name of the per-run template DB the workers are cloned from. */
export function templateDbName(baseUrl: string): string {
  return `${databaseName(baseUrl)}_tpl`;
}

/** Run `fn` on a one-connection client to the server's `postgres` DB. */
async function withAdmin(
  baseUrl: string,
  fn: (admin: postgres.Sql) => Promise<void>,
): Promise<void> {
  const admin = postgres(withDatabase(baseUrl, 'postgres'), { max: 1 });
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
}

/** Drop `name` if it exists (kicking any session), then create it. */
async function recreate(
  admin: postgres.Sql,
  name: string,
  template?: string,
): Promise<void> {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  const from = template ? ` TEMPLATE "${template}"` : '';
  await admin.unsafe(`CREATE DATABASE "${name}"${from}`);
}

/**
 * Recreate `<base>_tpl` empty and migrate it. The migrate client is closed
 * on return, which `CREATE DATABASE … TEMPLATE` requires (no session may
 * hold the template while it is copied). Returns the template's URL.
 */
export async function prepareTemplateDb(baseUrl: string): Promise<string> {
  const name = templateDbName(baseUrl);
  await withAdmin(baseUrl, (admin) => recreate(admin, name));
  const templateUrl = withDatabase(baseUrl, name);
  await runTestMigrations(templateUrl);
  return templateUrl;
}

/**
 * Clone the migrated `<base>_tpl` once per worker as `<base>_w1.._wN`;
 * returns the clone URLs. Call `prepareTemplateDb` first.
 */
export async function cloneWorkerDbs(
  baseUrl: string,
  workers: number,
): Promise<string[]> {
  const baseName = databaseName(baseUrl);
  const template = templateDbName(baseUrl);
  const urls: string[] = [];
  await withAdmin(baseUrl, async (admin) => {
    for (let i = 1; i <= workers; i++) {
      await recreate(admin, `${baseName}_w${i}`, template);
      urls.push(withDatabase(baseUrl, `${baseName}_w${i}`));
    }
  });
  return urls;
}

/** The DBs per-worker mode creates: `<base>_tpl`, then `<base>_w1.._wN`. */
export function workerDbNames(baseUrl: string, workers: number): string[] {
  const baseName = databaseName(baseUrl);
  const names = [templateDbName(baseUrl)];
  for (let i = 1; i <= workers; i++) names.push(`${baseName}_w${i}`);
  return names;
}

/**
 * Drop everything `prepareTemplateDb` + `cloneWorkerDbs` created (jest
 * globalTeardown). Never touches the base DB itself.
 */
export async function dropWorkerDbs(
  baseUrl: string,
  workers: number,
): Promise<void> {
  await withAdmin(baseUrl, async (admin) => {
    for (const name of workerDbNames(baseUrl, workers)) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
}

/** This worker's DB URL, or undefined when per-worker mode is off. */
export function workerDbUrl(): string | undefined {
  const list = (process.env[WORKER_DB_URLS_ENV] ?? '').split(' ');
  const id = Number(process.env.JEST_WORKER_ID ?? '1');
  if (list.length < 2 || !Number.isInteger(id) || id < 1) return undefined;
  return list[id - 1] || undefined;
}
