/**
 * ROK-2263: pure helpers for the backup-export token management API — the
 * mint-request parse (default expiry), the expiry date, the DTO mapping and
 * the `{ code, message }` error bodies. Nothing here sees a plaintext token.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  BACKUP_EXPORT_TOKEN_DEFAULT_EXPIRY_DAYS,
  BACKUP_EXPORT_TOKEN_LIVE_CAP,
  BackupExportTokenSchema,
  MintBackupExportTokenRequestSchema,
  type BackupExportToken,
  type BackupExportTokenExpiry,
  type MintBackupExportTokenRequest,
} from '@raid-ledger/contract';
import { handleValidationError } from '../../common/validation.util';
import type { BackupExportTokenDisplayRow } from './backup-export-tokens.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a mint body; a body with no `expiresInDays` key gets the 90-day default (Q5). */
export function parseMintRequest(body: unknown): MintBackupExportTokenRequest {
  const withDefault =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expiresInDays' in body)
      ? { ...body, expiresInDays: BACKUP_EXPORT_TOKEN_DEFAULT_EXPIRY_DAYS }
      : body;
  const parsed = MintBackupExportTokenRequestSchema.safeParse(withDefault);
  if (!parsed.success) handleValidationError(parsed.error);
  return parsed.data;
}

/** `expires_at` for a mint made at `now`; null = never expires. */
export function expiryFrom(
  days: BackupExportTokenExpiry,
  now: Date = new Date(),
): Date | null {
  return days === null ? null : new Date(now.getTime() + days * DAY_MS);
}

/** A display row as the contract DTO (ISO strings; never a hash). */
export function toBackupExportTokenDto(
  row: BackupExportTokenDisplayRow,
): BackupExportToken {
  return BackupExportTokenSchema.parse({
    id: row.id,
    label: row.label,
    tokenHint: row.tokenHint,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
}

/** 409 when minting would exceed the live-token cap (Q2). */
export function tokenCapReached(): ConflictException {
  return new ConflictException({
    code: 'backup_export_token_cap',
    message: `${BACKUP_EXPORT_TOKEN_LIVE_CAP} clone access tokens are already live — revoke one first`,
  });
}

/** 404 for an id that never existed. */
export function tokenNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'backup_export_token_not_found',
    message: 'No clone access token with that id',
  });
}
