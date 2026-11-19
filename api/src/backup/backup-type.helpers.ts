/**
 * The two backup folders a route may name. Shared by `BackupController` and
 * `BackupExportController` (ROK-2263 split) so both answer the same 400.
 */
import { BadRequestException } from '@nestjs/common';

export type BackupType = 'daily' | 'migration';

/** Narrow a `:type` route param, or throw the same 400 as before the split. */
export function validateBackupType(type: string): BackupType {
  if (type !== 'daily' && type !== 'migration') {
    throw new BadRequestException('Type must be "daily" or "migration"');
  }
  return type;
}
