/**
 * ROK-1956 §7.2 — daily orphan cleanup for the companion blob store:
 *   1. blob rows with no ref, older than 24 h → delete row, then unlink file;
 *   2. refs with no blob, older than 7 d → delete (the upload never came);
 *   3. files under `<root>/<userId>/` with no row, and stale temp uploads,
 *      older than 24 h → unlink.
 * Deletes run in batches of {@link CLEANUP_BATCH} (bounded per run). Windows
 * are the Q6 defaults. Referenced blobs stay until a plugin releases refs.
 * Review R1: every delete and unlink runs per user inside a transaction
 * holding that user's blob lock (the same one the upload and the messages
 * tx take), re-checking its predicate there.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  COMPANION_BLOB_FILE_RE,
  COMPANION_BLOB_TEMP_RE,
  companionBlobAbsolutePath,
  discardCompanionBlobFile,
  getCompanionBlobDir,
} from './companion-blob.paths';
import {
  danglingRefUsers,
  deleteDanglingRefsIn,
  deleteUnreferencedBlobsIn,
  storedShasIn,
  unreferencedBlobUsers,
} from './companion-blob-cleanup.queries';
import { CompanionBlobsRepository } from './companion-blobs.repository';

const JOB = 'CompanionBlobCleanupService_purgeOrphans';
export const CLEANUP_BATCH = 500;
const MAX_BATCHES = 20;
const UNREFERENCED_HOURS = 24;
const DANGLING_REF_DAYS = 7;
const FILE_AGE_MS = 24 * 60 * 60 * 1000;

/** Rows/files removed by one run (the log line). */
export interface CompanionBlobCleanupCounts {
  blobs: number;
  refs: number;
  files: number;
}

/** Daily orphan cleanup (CronJobModule-tracked). */
@Injectable()
export class CompanionBlobCleanupService {
  private readonly logger = new Logger(CompanionBlobCleanupService.name);

  constructor(
    private readonly repo: CompanionBlobsRepository,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Daily at 04:35. */
  @Cron('0 35 4 * * *', { name: JOB })
  async purgeOrphans(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB, async () => {
      const counts = await this.runOnce();
      this.logger.log(
        `Companion blob cleanup deleted blobs=${counts.blobs} refs=${counts.refs} files=${counts.files}`,
      );
    });
  }

  /** One pass of all three phases; `now` is injectable for specs. */
  async runOnce(now: number = Date.now()): Promise<CompanionBlobCleanupCounts> {
    const blobs = await this.purgeUnreferencedBlobs();
    const refs = await this.purgeDanglingRefs();
    const files = await this.sweepFiles(now - FILE_AGE_MS);
    return { blobs, refs, files };
  }

  /** Phase 1: row then file, both inside the user's lock window. */
  private async purgeUnreferencedBlobs(): Promise<number> {
    return batched(
      (db) => unreferencedBlobUsers(db, UNREFERENCED_HOURS, CLEANUP_BATCH),
      (userId) =>
        this.repo.withUserLock(userId, async (tx) => {
          const gone = await deleteUnreferencedBlobsIn(
            tx,
            userId,
            UNREFERENCED_HOURS,
            CLEANUP_BATCH,
          );
          for (const sha of gone) {
            await discardCompanionBlobFile(
              companionBlobAbsolutePath(userId, sha),
            );
          }
          return gone.length;
        }),
      this.repo,
    );
  }

  /** Phase 2: dangling refs, per user under the lock. */
  private async purgeDanglingRefs(): Promise<number> {
    return batched(
      (db) => danglingRefUsers(db, DANGLING_REF_DAYS, CLEANUP_BATCH),
      (userId) =>
        this.repo.withUserLock(userId, (tx) =>
          deleteDanglingRefsIn(tx, userId, DANGLING_REF_DAYS, CLEANUP_BATCH),
        ),
      this.repo,
    );
  }

  /** Phase 3 over every numeric user folder under the root. */
  private async sweepFiles(cutoffMs: number): Promise<number> {
    const root = getCompanionBlobDir();
    let removed = 0;
    for (const dir of await listDir(root)) {
      if (!/^[1-9][0-9]{0,9}$/.test(dir)) continue;
      removed += await this.sweepUser(
        Number(dir),
        path.join(root, dir),
        cutoffMs,
      );
    }
    return removed;
  }

  private async sweepUser(
    userId: number,
    dir: string,
    cutoffMs: number,
  ): Promise<number> {
    const old = await oldEntries(dir, await listDir(dir), cutoffMs);
    const temps = old.filter((n) => COMPANION_BLOB_TEMP_RE.test(n));
    const shaOf = (n: string): string | undefined =>
      COMPANION_BLOB_FILE_RE.exec(n)?.[1];
    const shas = old.map(shaOf).filter((s): s is string => s !== undefined);
    if (temps.length === 0 && shas.length === 0) return 0;
    return this.repo.withUserLock(userId, async (tx) => {
      const stored = await storedShasIn(tx, userId, shas);
      const orphans = shas
        .filter((s) => !stored.has(s))
        .map((s) => `${s}.webp`);
      for (const name of [...temps, ...orphans]) {
        await discardCompanionBlobFile(path.join(dir, name));
      }
      return temps.length + orphans.length;
    });
  }
}

/**
 * Find candidate users, run `perUser` for each (its own locked tx), and
 * repeat while a batch came back full (bounded by {@link MAX_BATCHES}).
 */
async function batched(
  candidates: (db: CompanionBlobsRepository['reader']) => Promise<number[]>,
  perUser: (userId: number) => Promise<number>,
  repo: CompanionBlobsRepository,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const users = await candidates(repo.reader);
    let full = users.length >= CLEANUP_BATCH;
    for (const userId of users) {
      const n = await perUser(userId);
      total += n;
      if (n >= CLEANUP_BATCH) full = true;
    }
    if (!full) break;
  }
  return total;
}

async function listDir(dir: string): Promise<string[]> {
  return readdir(dir).catch((err: unknown) => {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  });
}

/** Names in `dir` whose mtime is before `cutoffMs` (vanished ones skipped). */
async function oldEntries(
  dir: string,
  names: string[],
  cutoffMs: number,
): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) {
    const st = await stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile() && st.mtimeMs < cutoffMs) out.push(name);
  }
  return out;
}
