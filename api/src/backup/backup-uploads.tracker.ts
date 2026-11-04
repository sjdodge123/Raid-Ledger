/**
 * The admin "Create backup" archives uploads in the background (nginx gives
 * `/api/` 60 s; a large hub-media tree takes longer). This in-memory tracker
 * (the API is a single process) is how the backup list knows an archive is
 * still running, and it runs archives ONE AT A TIME across all dumps: each
 * job is chained after the previous one, so every disk-space pre-flight sees
 * the previous tar's final size and two multi-GB tars never grow at once.
 *
 * A restart forgets everything, which is the point: an archive killed
 * mid-run leaves only `<name>.uploads.tar.partial`, never the final name, so
 * the dump then simply lists without an archive — never a permanent
 * "archiving". (Boot removes those leftovers: `removeStalePartialArchives`.)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConflictException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { BackupUploadsArchiveDto } from '@raid-ledger/contract';

import {
  uploadsArchiveFailure,
  uploadsArchiveName,
  type UploadsArchiveResult,
} from './backup-uploads.helpers';

export const ARCHIVE_RUNNING_MESSAGE =
  'An uploads archive is still running — try again when it finishes';
export const DELETE_WHILE_ARCHIVING_MESSAGE =
  'Uploads archive in progress — delete after it finishes';

type ArchiveFailure = Extract<UploadsArchiveResult, { status: 'failed' }>;

/** UI copy per failure reason — never the raw tar/fs text (server paths, stderr). */
const PUBLIC_FAILURE: Record<ArchiveFailure['reason'], string> = {
  'insufficient-space': 'Not enough free space on the backup disk',
  'measure-failed': 'Could not measure the uploads folder — see server logs',
  'tar-failed': 'Archive failed — see server logs',
  timeout: 'Archive took too long and was stopped — see server logs',
};

/** Results whose throw `settle` already sent to Sentry (no second report). */
const capturedResults = new WeakSet<UploadsArchiveResult>();

export class UploadsArchiveTracker {
  private readonly running = new Map<string, Promise<UploadsArchiveResult>>();
  private readonly failures = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  /** A manual Create is dumping: its archive is not registered yet (MINOR 14). */
  private creating = false;

  constructor(
    private readonly dailyDir: string,
    private readonly logger?: { error(message: string): void },
  ) {}

  /**
   * Queue `archive` for a dump behind every archive already queued; a call
   * for a dump already queued/running joins it. Never rejects.
   */
  run(
    dumpFilename: string,
    archive: () => Promise<UploadsArchiveResult>,
  ): Promise<UploadsArchiveResult> {
    const existing = this.running.get(dumpFilename);
    if (existing) return existing;
    this.failures.delete(dumpFilename);
    const job = this.tail
      .then(() => settle(archive, this.logger))
      .then(
        (result) => this.finish(dumpFilename, result),
        (err: unknown) => this.finish(dumpFilename, threwResult(err)),
      );
    // A rejected link must never wedge every later archive (MINOR 15).
    this.tail = job.catch(() => undefined);
    this.running.set(dumpFilename, job);
    return job;
  }

  /** Manual Create: 409 while another Create dumps or any archive is queued or running. */
  assertIdle(): void {
    if (this.creating || this.running.size > 0)
      throw new ConflictException(ARCHIVE_RUNNING_MESSAGE);
  }

  /**
   * Manual Create: `assertIdle`, then hold the guard SYNCHRONOUSLY until
   * `create` (dump + archive registration) settles, so a second POST during
   * the dump is a 409 too — not a second dump of the same second (MINOR 14).
   */
  async exclusive<T>(create: () => Promise<T>): Promise<T> {
    this.assertIdle();
    this.creating = true;
    try {
      return await create();
    } finally {
      this.creating = false;
    }
  }

  /** Delete: 409 while this dump's archive is queued or running. */
  assertNotArchiving(dumpFilename: string): void {
    if (this.running.has(dumpFilename))
      throw new ConflictException(DELETE_WHILE_ARCHIVING_MESSAGE);
  }

  /** Drop a deleted dump's recorded failure. */
  forget(dumpFilename: string): void {
    this.failures.delete(dumpFilename);
  }

  /** Resolves once every archive queued so far has settled (test seam). */
  async whenIdle(): Promise<void> {
    await this.tail;
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

  private finish(
    dumpFilename: string,
    result: UploadsArchiveResult,
  ): UploadsArchiveResult {
    this.running.delete(dumpFilename);
    if (result.status === 'failed')
      this.failures.set(dumpFilename, PUBLIC_FAILURE[result.reason]);
    return result;
  }
}

function threwResult(
  err: unknown,
): Extract<UploadsArchiveResult, { reason: 'tar-failed' }> {
  const detail = err instanceof Error ? err.message : String(err);
  return { status: 'failed', reason: 'tar-failed', detail };
}

/** `archiveUploadsForDump` never throws by contract; this keeps it so. */
async function settle(
  archive: () => Promise<UploadsArchiveResult>,
  logger: { error(message: string): void } | undefined,
): Promise<UploadsArchiveResult> {
  try {
    return await archive();
  } catch (err) {
    Sentry.captureException(err, { tags: { backup: 'uploads-archive' } });
    const result = threwResult(err);
    capturedResults.add(result);
    logger?.error(`uploads archive threw: ${result.detail}`);
    return result;
  }
}

/** A background archive has no caller to fail: its failure goes to Sentry (once). */
export function reportBackgroundArchive(result: UploadsArchiveResult): void {
  const failure = uploadsArchiveFailure(result);
  if (failure && !capturedResults.has(result))
    Sentry.captureMessage(failure, 'error');
}
