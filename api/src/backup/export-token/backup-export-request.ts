/**
 * ROK-2263 D4: what `BackupExportAuthGuard` attaches for an `rlbx_` bearer.
 * Its own key — the guard never sets `req.user`, so nothing that reads a
 * session user can mistake an export token for a signed-in admin.
 */
import type { Request } from 'express';

/** The token behind an accepted `rlbx_` bearer. Never the token itself. */
export interface BackupExportAuth {
  tokenId: number;
  ownerUserId: number;
}

/** An Express request before or after the export guard ran. */
export type BackupExportRequest = Request & {
  backupExport?: BackupExportAuth;
};
