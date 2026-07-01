/**
 * Helper functions for backup service (pg_dump/pg_restore execution).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InternalServerErrorException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { runBootMigrations } from '../../scripts/run-migrations-with-sentry';

const execFileAsync = promisify(execFile);

/** Build `--exclude-table-data=<t>` flags for each sanitized table. */
function excludeTableDataFlags(tables?: readonly string[]): string[] {
  if (!tables || tables.length === 0) return [];
  return tables.map((t) => `--exclude-table-data=${t}`);
}

/** Build pg_dump args for custom format. */
function pgDumpArgs(
  outputPath: string,
  dbUrl: string,
  excludeTableData?: readonly string[],
): string[] {
  return [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${outputPath}`,
    ...excludeTableDataFlags(excludeTableData),
    dbUrl,
  ];
}

/** Run pg_dump directly (production). */
export async function runPgDumpDirect(
  outputPath: string,
  dbUrl: string,
  excludeTableData?: readonly string[],
): Promise<void> {
  await execFileAsync(
    'pg_dump',
    pgDumpArgs(outputPath, dbUrl, excludeTableData),
  );
}

/** Run pg_dump via Docker container (dev). */
export async function runPgDumpDocker(
  outputPath: string,
  dbUrl: string,
  container: string,
  excludeTableData?: readonly string[],
): Promise<void> {
  const containerTmp = '/tmp/backup.dump';
  await execFileAsync('docker', [
    'exec',
    container,
    'pg_dump',
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${containerTmp}`,
    ...excludeTableDataFlags(excludeTableData),
    dbUrl,
  ]);
  await execFileAsync('docker', [
    'cp',
    `${container}:${containerTmp}`,
    outputPath,
  ]);
  await execFileAsync('docker', ['exec', container, 'rm', '-f', containerTmp]);
}

/** Run pg_restore directly (production). */
export async function runPgRestoreDirect(
  filepath: string,
  dbUrl: string,
): Promise<void> {
  await execFileAsync('pg_restore', [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    `--dbname=${dbUrl}`,
    filepath,
  ]);
}

/** Run pg_restore via Docker container (dev). */
export async function runPgRestoreDocker(
  filepath: string,
  dbUrl: string,
  container: string,
): Promise<void> {
  const containerTmp = '/tmp/restore.dump';
  await execFileAsync('docker', [
    'cp',
    filepath,
    `${container}:${containerTmp}`,
  ]);
  await execFileAsync('docker', [
    'exec',
    container,
    'pg_restore',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    `--dbname=${dbUrl}`,
    containerTmp,
  ]);
  await execFileAsync('docker', ['exec', container, 'rm', '-f', containerTmp]);
}

/** Check if pg_restore error is fatal (vs. harmless warnings). */
export function isRestoreFatal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('pg_restore: error:') &&
    !message.includes('errors ignored on restore')
  );
}

/**
 * Resolve the drizzle migrations folder for the restore path.
 *
 * Precedence:
 *   1. `MIGRATIONS_FOLDER` env var if set (operator override / boot script).
 *   2. `${apiRoot}/src/drizzle/migrations` (source tree — dev, tests, runner).
 *   3. `${apiRoot}/drizzle/migrations` (allinone production image — see
 *      Dockerfile.allinone line 165 which copies migrations to /app/drizzle).
 */
function resolveMigrationsFolder(apiRoot: string): string {
  const candidates = [
    process.env.MIGRATIONS_FOLDER,
    path.resolve(apiRoot, 'src/drizzle/migrations'),
    path.resolve(apiRoot, 'drizzle/migrations'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  const migrationsFolder = candidates.find((p) =>
    fs.existsSync(path.join(p, 'meta', '_journal.json')),
  );
  if (!migrationsFolder) {
    throw new Error(
      `Could not locate drizzle migrations folder (searched: ${candidates.join(', ')})`,
    );
  }
  return migrationsFolder;
}

/**
 * Run post-restore / factory-reset database migrations.
 *
 * ROK-1322: routes through the SAME instrumented runner as the deploy-time
 * boot path — `runBootMigrations` — so restore gets the identical invariant:
 *   1. Refresh `games_dedup_audit` BEFORE migrate (the real 2026-05-14
 *      incident-prevention: a data migration consuming a stale audit blows up).
 *   2. Run the programmatic `migrate()` (the drizzle-kit CLI silently swallows
 *      SQL errors — upstream drizzle-team/drizzle-orm#5601 — see ROK-1343).
 *   3. `validateMigrationState` (journal-vs-applied + critical-table probe;
 *      diagnostic-only, never throws) for the same phantom-migration visibility.
 * Failures are captured to Sentry tagged `restore-migration` and flushed BEFORE
 * re-throwing — instrumented inside `runBootMigrations`, so this call site adds
 * no wrapper (avoids double-capture). The error still re-throws so callers keep
 * their existing propagation semantics.
 *
 * `databaseUrl` is threaded from the caller (`backup.service` has it as
 * `DATABASE_URL` from config); falls back to `process.env.DATABASE_URL`.
 */
export async function runMigrations(
  apiRoot: string,
  databaseUrl?: string,
): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder(apiRoot);
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for restore-time migrations');
  }
  await runBootMigrations(url, {
    migrationsFolder,
    context: 'restore-migration',
  });
}

/** Run bootstrap-admin script and extract password. */
export async function bootstrapAdmin(apiRoot: string): Promise<string> {
  const isDocker = process.env.NODE_ENV === 'production';
  const runner = isDocker ? 'node' : 'npx';
  const args = isDocker
    ? [path.resolve('dist/scripts/bootstrap-admin.js'), '--reset']
    : [
        'ts-node',
        path.resolve(apiRoot, 'scripts/bootstrap-admin.ts'),
        '--reset',
      ];
  const { stdout } = await execFileAsync(runner, args, {
    cwd: apiRoot,
    env: { ...process.env, RESET_PASSWORD: 'true' },
  });
  const match = stdout.match(/Password:\s+(.+)/);
  if (!match) {
    throw new InternalServerErrorException(
      'Reset completed but failed to extract new admin credentials',
    );
  }
  return match[1].trim();
}

/** Run seed scripts for game data. */
export async function seedGameData(apiRoot: string): Promise<void> {
  const isDocker = process.env.NODE_ENV === 'production';
  const runner = isDocker ? 'node' : 'npx';
  const gamesArgs = isDocker
    ? [path.resolve('dist/scripts/seed-games.js')]
    : ['ts-node', path.resolve(apiRoot, 'scripts/seed-games.ts')];
  const igdbArgs = isDocker
    ? [path.resolve('dist/scripts/seed-igdb-games.js')]
    : ['ts-node', path.resolve(apiRoot, 'scripts/seed-igdb-games.ts')];
  await execFileAsync(runner, gamesArgs, { cwd: apiRoot });
  await execFileAsync(runner, igdbArgs, { cwd: apiRoot });
}

/** Drop and recreate database schemas. */
export async function dropSchemas(
  dbUrl: string,
  container: string,
): Promise<void> {
  const dropSql =
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;';
  if (!container) {
    await execFileAsync('psql', [dbUrl, '-c', dropSql]);
  } else {
    await execFileAsync('docker', [
      'exec',
      container,
      'psql',
      dbUrl,
      '-c',
      dropSql,
    ]);
  }
}

/** Clean up partial file on error, ignoring cleanup failures. */
export function cleanupPartialFile(filepath: string): void {
  try {
    fs.unlinkSync(filepath);
  } catch {
    // ignore cleanup errors
  }
}
