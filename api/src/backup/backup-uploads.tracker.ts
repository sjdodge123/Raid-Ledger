/**
 * The admin "Create backup" archives uploads in the background (nginx gives
 * `/api/` 60 s; a large hub-media tree takes longer). This in-memory tracker
 * (the API is a single process) is how the backup list knows an archive is
 * still running, and how a second request for the same dump joins the first
 * archive instead of starting another tar.
 *
 * A restart forgets everything, which is the point: an archive killed
 * mid-run leaves only `<name>.uploads.tar.partial`, never the final name, so
 * the dump then simply lists without an archive — never a permanent
 * "archiving".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as Sentry from '@sentry/nestjs';
import type { BackupUploadsArchiveDto } from '@raid-ledger/contract';

import {
  uploadsArchiveFailure,
  uploadsArchiveName,
  type UploadsArchiveResult,
} from './backup-uploads.helpers';

export class UploadsArchiveTracker {
  private readonly running = new Map<string, Promise<UploadsArchiveResult>>();
  private readonly failures = new Map<string, string>();

  constructor(private readonly dailyDir: string) {}

  /** Run `archive` for a dump; a call while one runs joins it. Never rejects. */
  run(
    dumpFilename: string,
    archive: () => Promise<UploadsArchiveResult>,
  ): Promise<UploadsArchiveResult> {
    const existing = this.running.get(dumpFilename);
    if (existing) return existing;
    this.failures.delete(dumpFilename);
    const job = settle(archive).then((result) => {
      this.running.delete(dumpFilename);
      const failure = uploadsArchiveFailure(result);
      if (failure) this.failures.set(dumpFilename, failure);
      return result;
    });
    this.running.set(dumpFilename, job);
    return job;
  }

  /** The list entry's `uploadsArchive`, or undefined when the dump has none. */
  stateOf(dumpFilename: string): BackupUploadsArchiveDto | undefined {
    if (this.running.has(dumpFilename)) return { state: 'archiving' };
    const error = this.failures.get(dumpFilename);
    if (error) return { state: 'failed', error };
    const tar = path.join(this.dailyDir, uploadsArchiveName(dumpFilename));
    try {
      return { state: 'ready', sizeBytes: fs.statSync(tar).size };
    } catch {
      return undefined;
    }
  }
}

/** `archiveUploadsForDump` never throws by contract; this keeps it so. */
async function settle(
  archive: () => Promise<UploadsArchiveResult>,
): Promise<UploadsArchiveResult> {
  try {
    return await archive();
  } catch (err) {
    Sentry.captureException(err, { tags: { backup: 'uploads-archive' } });
    const detail = err instanceof Error ? err.message : String(err);
    return { status: 'failed', reason: 'tar-failed', detail };
  }
}

/** A background archive has no caller to fail: its failure goes to Sentry. */
export function reportBackgroundArchive(result: UploadsArchiveResult): void {
  const failure = uploadsArchiveFailure(result);
  if (failure) Sentry.captureMessage(failure, 'error');
}
