/**
 * Helper functions for backup service (pg_dump/pg_restore execution).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InternalServerErrorException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

/** Build pg_dump args for custom format. */
function pgDumpArgs(outputPath: string, dbUrl: string): string[] {
  return [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${outputPath}`,
    dbUrl,
  ];
}

/** Run pg_dump directly (production). */
export async function runPgDumpDirect(
  outputPath: string,
  dbUrl: string,
): Promise<void> {
  await execFileAsync('pg_dump', pgDumpArgs(outputPath, dbUrl));
}

/** Run pg_dump via Docker container (dev). */
export async function runPgDumpDocker(
  outputPath: string,
  dbUrl: string,
  container: string,
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

/** Run post-restore database migrations. */
export async function runMigrations(apiRoot: string): Promise<void> {
  const isDocker = process.env.NODE_ENV === 'production';
  if (isDocker) {
    await execFileAsync('node', [path.resolve('drizzle/run-migrations.js')]);
  } else {
    await execFileAsync('npx', ['drizzle-kit', 'migrate'], { cwd: apiRoot });
  }
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
