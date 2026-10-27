/**
 * ROK-2023 — BackupService's side of the companion uploads archive, kept out
 * of the service file (300-line cap). Imports `archiveUploads` from its own
 * module so the service unit spec can mock it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  archiveUploads,
  resolveUploadsDir,
  uploadsArchiveFailure,
  uploadsArchiveName,
  type UploadsArchiveResult,
} from './backup-uploads.helpers';

export interface BackupLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Write `daily/<dump ts>.uploads.tar`; logs the outcome (failed → error), never throws. */
export async function archiveUploadsForDump(
  dailyDir: string,
  dumpFilename: string,
  logger: BackupLogger,
): Promise<UploadsArchiveResult> {
  const archive = await archiveUploads({
    uploadsDir: resolveUploadsDir(),
    outPath: path.join(dailyDir, uploadsArchiveName(dumpFilename)),
    dailyDir,
    warn: (m) => logger.warn(m),
  });
  const failure = uploadsArchiveFailure(archive);
  if (failure) logger.error(failure);
  else if (archive.status === 'written')
    logger.log(`Uploads archive complete: ${archive.path}`);
  return archive;
}

/** Spec D10c: remove a daily dump's companion archive; missing is fine, a failed unlink warns. */
export function deleteUploadsArchiveOf(
  dailyDir: string,
  dumpFilename: string,
  logger: BackupLogger,
): void {
  const archive = path.join(dailyDir, uploadsArchiveName(dumpFilename));
  if (!fs.existsSync(archive)) return;
  try {
    fs.unlinkSync(archive);
    logger.log(`Deleted uploads archive: daily/${path.basename(archive)}`);
  } catch (err) {
    logger.warn(
      `Could not delete uploads archive ${archive}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
