/**
 * #1949 review NIT 22 — unique daily dump names. A manual Create and the
 * 02:00:10 cron in the same second used to get the same
 * `raid_ledger_<YYYY-MM-DD_HHMMSS>.dump`, and the second pg_dump overwrote
 * the first. The second-resolution name stays the base (listing, rotation,
 * the restore drill and `uploadsArchiveName` all key off it); a clash takes
 * `_2`, `_3`, … before `.dump`. That keeps the `raid_ledger_*.dump` and
 * `raid_ledger_*.uploads.tar` patterns, and `_` sorts after `.`, so the
 * rotation's equal-mtime name tie-break still ranks the later dump newer.
 * Kept out of backup.service.ts (300-line cap).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { formatBackupTimestamp } from './backup.helpers';
import { uploadsArchiveName } from './backup-uploads.helpers';

/** Give up probing after this many suffixes; a backup beats a perfect name. */
const MAX_SUFFIX = 50;

type ExistsFn = (filepath: string) => boolean;

export function dailyDumpName(stamp: string, n: number): string {
  return n <= 1
    ? `raid_ledger_${stamp}.dump`
    : `raid_ledger_${stamp}_${n}.dump`;
}

/**
 * Hands out daily dump names. The per-second counter covers two dumps that
 * start before either file exists (pg_dump writes late); the disk check
 * covers a name already used (an earlier process, a DST repeat hour).
 */
export class DailyDumpNamer {
  private stamp = '';
  private count = 0;

  next(dailyDir: string, now: Date, exists: ExistsFn = fs.existsSync): string {
    const stamp = formatBackupTimestamp(now);
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.count = 0;
    }
    const used = (name: string): boolean =>
      exists(path.join(dailyDir, name)) ||
      exists(path.join(dailyDir, uploadsArchiveName(name)));
    do {
      this.count += 1;
    } while (this.count < MAX_SUFFIX && used(dailyDumpName(stamp, this.count)));
    return dailyDumpName(stamp, this.count);
  }
}

interface DumpLogger {
  log(message: string): void;
}

/** Write `daily/<unique name>.dump` with `runPgDump`; returns its filename. */
export async function writeDailyDump(
  dailyDir: string,
  filename: string,
  runPgDump: (outputPath: string) => Promise<void>,
  logger: DumpLogger,
): Promise<string> {
  const dumpPath = path.join(dailyDir, filename);
  logger.log(`Starting daily backup: ${filename}`);
  await runPgDump(dumpPath);
  const stats = fs.statSync(dumpPath);
  logger.log(
    `Daily backup complete: ${filename} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`,
  );
  return filename;
}
