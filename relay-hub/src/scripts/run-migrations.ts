/**
 * Relay hub migration runner (ROK-1670). Programmatic Drizzle migrator, never
 * `drizzle-kit migrate`. Self-contained: no Nest bootstrap. On any failure it
 * captures to Sentry with `context: boot.migration`, awaits the flush, then
 * exits 1 (the contract of api's run-migrations-with-sentry.ts).
 *
 *   node dist/scripts/run-migrations.js            apply pending migrations
 *   node dist/scripts/run-migrations.js --status   print {applied, head, pending}
 */
import '../sentry/instrument'; // MUST be first — installs Sentry before anything else
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as path from 'path';
import postgres, { type Sql } from 'postgres';
import {
  resolveDatabaseUrl,
  type DatabaseUrlEnv,
} from '../config/database-url';
import { reportBootFailure } from '../sentry/report-boot-failure';
import { readStatus } from './migration-status';

/** Same folder from src/scripts (ts-node) and dist/scripts (L1). */
export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(
  __dirname,
  '../../drizzle/migrations',
);

export type RunnerEnv = DatabaseUrlEnv & {
  readonly HUB_MIGRATIONS_FOLDER?: string | undefined;
};

export function migrationsFolder(env: RunnerEnv): string {
  return env.HUB_MIGRATIONS_FOLDER || DEFAULT_MIGRATIONS_FOLDER;
}

async function withClient<T>(
  url: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runMigrations(
  url: string,
  folder: string,
): Promise<void> {
  await withClient(url, (sql) =>
    migrate(drizzle(sql), { migrationsFolder: folder }),
  );
}

export async function main(
  argv: readonly string[],
  env: RunnerEnv,
  write: (line: string) => void = (line) => process.stdout.write(line),
): Promise<void> {
  const url = resolveDatabaseUrl(env);
  const folder = migrationsFolder(env);
  if (argv.includes('--status')) {
    const status = await withClient(url, (sql) => readStatus(sql, folder));
    write(`${JSON.stringify(status)}\n`);
    return;
  }
  await runMigrations(url, folder);
}

/** Exit 0 on success; on failure capture → await flush → exit 1. */
export async function runCli(
  argv: readonly string[],
  env: RunnerEnv,
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  try {
    await main(argv, env);
  } catch (err) {
    await reportBootFailure(err, 'boot.migration').catch(() => undefined);
    exit(1);
    return;
  }
  exit(0);
}

if (require.main === module) {
  void runCli(process.argv.slice(2), process.env);
}
