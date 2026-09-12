import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Prefix so a simulated artefact is never mistaken for a real backup. */
export const CORRUPT_PREFIX = 'corrupt_';

/** Matches T-I4's shape: header intact, archive body cut off. */
const TRUNCATE_BYTES = 1024;

const GARBAGE_BODY = Buffer.from(
  'ROK-1160 simulated corruption: this is not a pg_dump archive.\n'.repeat(16),
  'utf8',
);

const DEFAULT_BACKUP_BASE = path.join(process.cwd(), 'backups');

export type CorruptionMode = 'truncate' | 'garbage';

/**
 * Resolve the daily backup directory.
 *
 * Source of truth: `api/src/backup/backup.service.ts:74-76` (`BACKUP_DIR` via
 * ConfigService, then `path.join(base, 'daily')`). This mirrors it rather than
 * adding a method to BackupService, which is at its 300-line ESLint budget.
 * Same mirroring convention as `scripts/restore-drill.constants.mjs`.
 */
export function resolveDailyDir(config: ConfigService): string {
  const base = config.get<string>('BACKUP_DIR') || DEFAULT_BACKUP_BASE;
  return path.join(base, 'daily');
}

/** Newest real (non-simulated) `.dump` in the daily dir, or null. */
export function findNewestRealDump(dailyDir: string): string | null {
  const candidates = fs
    .readdirSync(dailyDir)
    .filter((f) => f.endsWith('.dump') && !f.startsWith(CORRUPT_PREFIX));
  let newest: { name: string; mtimeMs: number } | null = null;
  for (const name of candidates) {
    const { mtimeMs } = fs.statSync(path.join(dailyDir, name));
    if (!newest || mtimeMs > newest.mtimeMs) newest = { name, mtimeMs };
  }
  return newest?.name ?? null;
}

function corruptFilename(mode: CorruptionMode): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${CORRUPT_PREFIX}${mode}_${stamp}.dump`;
}

function truncatedCopy(dailyDir: string): Buffer {
  const source = findNewestRealDump(dailyDir);
  if (!source) {
    throw new BadRequestException(
      `No source .dump to truncate in ${dailyDir} — take a backup first. ` +
        'Refusing to silently fall back to mode=garbage.',
    );
  }
  return fs
    .readFileSync(path.join(dailyDir, source))
    .subarray(0, TRUNCATE_BYTES);
}

/**
 * Write an intentionally bad `.dump` into the daily dir and return its
 * filename. `truncate` keeps a real archive header (so pg_restore fails on the
 * body); `garbage` is not an archive at all.
 */
export function writeCorruptDump(
  dailyDir: string,
  mode: CorruptionMode,
): string {
  const contents = mode === 'truncate' ? truncatedCopy(dailyDir) : GARBAGE_BODY;
  const filename = corruptFilename(mode);
  fs.writeFileSync(path.join(dailyDir, filename), contents);
  return filename;
}
