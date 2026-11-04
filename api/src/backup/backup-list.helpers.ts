/** BackupService.listBackups' directory scan, kept out of the service file (300-line cap). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import type {
  BackupFileDto,
  BackupUploadsArchiveDto,
} from '@raid-ledger/contract';

import { isSafeBackupFilename } from './backup.helpers';

type BackupType = BackupFileDto['type'];

/** Every `.dump` in each dir, newest first; a daily dump carries its uploads archive state. */
export function listBackupFiles(
  dirs: ReadonlyArray<readonly [string, BackupType]>,
  archiveOf: (dumpFilename: string) => BackupUploadsArchiveDto | undefined,
): BackupFileDto[] {
  const backups: BackupFileDto[] = [];
  for (const [dir, type] of dirs) {
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.dump')) continue;
        const stats = fs.statSync(path.join(dir, file));
        const archive = type === 'daily' ? archiveOf(file) : undefined;
        backups.push({
          filename: file,
          type,
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
          ...(archive ? { uploadsArchive: archive } : {}),
        });
      }
    } catch {
      /* Directory may not exist yet */
    }
  }
  return backups.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Absolute path of `filename` inside `dir`, or NotFoundException. Traversal
 * collapses to 404 — never 400 (ROK-1279). An in-flight
 * `.uploads.tar.partial` is never served (504 review NIT 12).
 */
export function resolveBackupFile(
  dir: string,
  type: BackupType,
  filename: string,
): string {
  const notFound = `Backup file not found: ${type}/${filename}`;
  if (!isSafeBackupFilename(filename) || filename.endsWith('.partial'))
    throw new NotFoundException(notFound);
  const resolved = path.resolve(dir, filename);
  if (path.dirname(resolved) !== path.resolve(dir))
    throw new NotFoundException(notFound);
  if (!fs.existsSync(resolved)) throw new NotFoundException(notFound);
  return resolved;
}
