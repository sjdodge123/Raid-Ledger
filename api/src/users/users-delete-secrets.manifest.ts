/**
 * WIPE entries for the user's bearer secrets — rows that grant access on their
 * own, so a ban+wipe (which keeps the users row, so CASCADE never fires) must
 * delete them explicitly. Spread into `WIPE_BY_COLUMN` (users-delete.helpers).
 */
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../drizzle/schema';

/** A user-owned table deleted by a single `<column> = userId` predicate. */
export interface WipeTarget {
  table: PgTable;
  column: AnyPgColumn;
}

export const WIPE_BEARER_SECRETS: readonly WipeTarget[] = [
  // ROK-1599: the private ICS subscribe link (CASCADE) — a bearer secret.
  { table: schema.calendarFeeds, column: schema.calendarFeeds.userId },
  // ROK-1955: Companion device tokens (CASCADE) — bearer secrets, so a
  // ban+wipe must revoke them. Links the user decided go first: their
  // `device_id` is SET NULL, but deleting them keeps no stale approval trail.
  {
    table: schema.companionDeviceLinks,
    column: schema.companionDeviceLinks.decidedBy,
  },
  { table: schema.companionDevices, column: schema.companionDevices.userId },
  // ROK-2263: backup-export tokens the user minted (CASCADE) — bearer
  // secrets with backup-download power, so a ban+wipe must revoke them.
  {
    table: schema.backupExportTokens,
    column: schema.backupExportTokens.createdBy,
  },
];
