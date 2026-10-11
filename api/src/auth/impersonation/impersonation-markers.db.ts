/**
 * ROK-1754: DB primitives for `refresh_family_impersonations` that take the
 * `db`/`tx` as an argument, so the session service, the start transaction and
 * the user data-wipe (`users-delete.helpers.ts`, no DI) all end markers the
 * same way: `DELETE … RETURNING`, then ONE `impersonate_stop` audit per row.
 */
import { Logger } from '@nestjs/common';
import { eq, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { RefreshFamilyImpersonation } from '../../drizzle/schema';
import { insertAdminAction } from '../../users/users-admin-actions.helpers';
import {
  auditMetadata,
  type ImpersonationEndReason,
} from './impersonation-session.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const markers = schema.refreshFamilyImpersonations;
const logger = new Logger('ImpersonationMarkers');

/** Audit `impersonate_start`; `familyId: null` = cookie-less token. */
export async function auditImpersonationStart(
  db: Db,
  adminId: number,
  targetId: number,
  familyId: string | null,
): Promise<void> {
  await insertAdminAction(db, {
    action: 'impersonate_start',
    actorId: adminId,
    targetId,
    metadata: auditMetadata({ familyId, persistent: familyId !== null }),
  });
}

/** One `impersonate_stop` audit per ended marker. */
async function auditStops(
  db: Db,
  rows: RefreshFamilyImpersonation[],
  reason: ImpersonationEndReason,
): Promise<void> {
  for (const row of rows) {
    logger.log(
      `IMPERSONATION END: admin id:${row.impersonatorUserId} -> id:${row.targetUserId} (${reason})`,
    );
    await insertAdminAction(db, {
      action: 'impersonate_stop',
      actorId: row.impersonatorUserId,
      targetId: row.targetUserId,
      metadata: auditMetadata({
        familyId: row.familyId,
        persistent: true,
        reason,
      }),
    });
  }
}

/** Delete the markers matching `where` and audit each stop. */
export async function endMarkersWhere(
  db: Db,
  where: SQL | undefined,
  reason: ImpersonationEndReason,
): Promise<RefreshFamilyImpersonation[]> {
  const rows = await db.delete(markers).where(where).returning();
  await auditStops(db, rows, reason);
  return rows;
}

/**
 * User data-wipe / hard delete: end every marker where the user is the
 * impersonator OR the target (ban+wipe keeps the users row, so the FK
 * CASCADE never fires).
 */
export async function endMarkersInvolvingUser(
  db: Db,
  userId: number,
): Promise<RefreshFamilyImpersonation[]> {
  return endMarkersWhere(
    db,
    or(
      eq(markers.impersonatorUserId, userId),
      eq(markers.targetUserId, userId),
    ),
    'user_wiped',
  );
}
