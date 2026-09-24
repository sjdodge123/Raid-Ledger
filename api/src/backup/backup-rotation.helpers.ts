import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Backup-directory rotation. Both rotations log a warning and never throw:
 * they run at boot and inside the tracked 02:00 cron, and a pruning failure
 * must not fail either.
 */

type WarnFn = (message: string) => void;

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Remove every file in `dir` whose mtime is older than `retentionDays`. */
export function rotateDailyDir(
  dir: string,
  retentionDays: number,
  warn: WarnFn,
): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  let removed = 0;
  try {
    for (const file of fs.readdirSync(dir)) {
      const filepath = path.join(dir, file);
      if (fs.statSync(filepath).mtime < cutoff) {
        fs.unlinkSync(filepath);
        removed++;
      }
    }
  } catch (err) {
    warn(`Backup rotation error: ${errMessage(err)}`);
  }
  return removed;
}

// ROK-1663: only the per-boot entrypoint dumps rotate. pre_restore_ and
// pre_factory-reset_ snapshots share the directory but are operator-triggered
// safety nets — manual delete only.
const SNAPSHOT_PREFIX = 'pre_migration_';
const SNAPSHOT_SUFFIX = '.dump';

interface Snapshot {
  name: string;
  filepath: string;
  mtimeMs: number;
}

/**
 * Newest first by mtime. Equal mtimes fall back to the filename, whose
 * embedded YYYY-MM-DD_HHMMSS timestamp sorts lexically — later name = newer.
 */
const newestFirst = (a: Snapshot, b: Snapshot): number =>
  b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0);

/** Regular `pre_migration_*.dump` files in `dir`; symlinks and unstat-able files are skipped. */
function listSnapshots(dir: string, warn: WarnFn): Snapshot[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    warn(`Snapshot rotation: cannot read ${dir}: ${errMessage(err)}`);
    return [];
  }
  const snapshots: Snapshot[] = [];
  for (const name of names) {
    if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith(SNAPSHOT_SUFFIX))
      continue;
    const filepath = path.join(dir, name);
    try {
      const stats = fs.lstatSync(filepath); // lstat: never follow a symlink out
      if (stats.isFile())
        snapshots.push({ name, filepath, mtimeMs: stats.mtime.getTime() });
    } catch (err) {
      warn(`Snapshot rotation: cannot stat ${name}: ${errMessage(err)}`);
    }
  }
  return snapshots;
}

/** Keep the newest `keep` (min 1) pre-migration snapshots in `dir`; unlink the rest. */
export function rotateMigrationDir(
  dir: string,
  keep: number,
  warn: WarnFn,
): number {
  const stale = listSnapshots(dir, warn)
    .sort(newestFirst)
    .slice(Math.max(1, keep));
  let removed = 0;
  for (const { name, filepath } of stale) {
    try {
      fs.unlinkSync(filepath);
      removed++;
    } catch (err) {
      warn(`Snapshot rotation: cannot remove ${name}: ${errMessage(err)}`);
    }
  }
  return removed;
}
