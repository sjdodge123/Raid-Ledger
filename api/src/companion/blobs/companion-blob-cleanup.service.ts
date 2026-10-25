/**
 * ROK-1956 §7.2 — daily orphan cleanup for the companion blob store:
 *   1. blob rows with no ref, older than 24 h → delete row, then unlink file;
 *   2. refs with no blob, older than 7 d → delete (the upload never came);
 *   3. files under `<root>/<userId>/` with no row, and stale temp uploads,
 *      older than 24 h → unlink.
 * Deletes run in batches of {@link CLEANUP_BATCH} (bounded per run). Windows
 * are the Q6 defaults. Referenced blobs stay until a plugin releases refs.
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
    const refs = await batched(() =>
      this.repo.deleteDanglingRefs(DANGLING_REF_DAYS, CLEANUP_BATCH),
    );
    const files = await this.sweepFiles(now - FILE_AGE_MS);
    return { blobs, refs, files };
  }

  private async purgeUnreferencedBlobs(): Promise<number> {
    return batched(async () => {
      const gone = await this.repo.deleteUnreferencedBlobs(
        UNREFERENCED_HOURS,
        CLEANUP_BATCH,
      );
      for (const b of gone) {
        await discardCompanionBlobFile(
          companionBlobAbsolutePath(b.userId, b.sha256),
        );
      }
      return gone.length;
    });
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
    const stored = await this.repo.storedShas(userId, shas);
    const orphans = shas.filter((s) => !stored.has(s)).map((s) => `${s}.webp`);
    for (const name of [...temps, ...orphans]) {
      await discardCompanionBlobFile(path.join(dir, name));
    }
    return temps.length + orphans.length;
  }
}

/** Repeat a batch delete until it returns a short batch (bounded). */
async function batched(step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await step();
    total += n;
    if (n < CLEANUP_BATCH) break;
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
