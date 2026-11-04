/** BackupService.listBackups' directory scan, kept out of the service file (300-line cap). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  BackupFileDto,
  BackupUploadsArchiveDto,
} from '@raid-ledger/contract';

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
