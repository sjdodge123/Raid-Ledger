/**
 * Private-lineup participation eligibility (ROK-1065).
 *
 * Public lineups allow any community member; private lineups are scoped to
 * the creator, explicit invitees in `community_lineup_invitees`, and any
 * admin/operator. These helpers encapsulate the visibility check so
 * controllers, services, and listeners share one definition.
 */
import { ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Subset of lineup fields required for visibility checks. */
export interface VisibilityLineup {
  id: number;
  createdBy: number;
  visibility: 'public' | 'private';
}

/** Caller identity (matches CallerIdentity in lineups.service.ts). */
export interface EligibilityCaller {
  id: number;
  role?: string;
}

/**
 * Return every user ID pinned as an invitee on the given lineup.
 * Empty array for public lineups (invitees are only meaningful for private).
 */
export async function loadInvitees(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.communityLineupInvitees.userId })
    .from(schema.communityLineupInvitees)
    .where(eq(schema.communityLineupInvitees.lineupId, lineupId));
  return rows.map((r) => r.userId);
}

/**
 * True when the caller is a member of the lineup's invitee list (a plain
 * invitee, not counting the creator or admin/operator roles).
 */
export async function isInvitee(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.communityLineupInvitees.id })
    .from(schema.communityLineupInvitees)
    .where(
      and(
        eq(schema.communityLineupInvitees.lineupId, lineupId),
        eq(schema.communityLineupInvitees.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Throw ForbiddenException when the caller may not participate
 * (nominate / vote / bandwagon-join) on a private lineup. Public lineups
 * always pass.
 */
export async function assertUserCanParticipate(
  db: Db,
  lineup: VisibilityLineup,
  caller: EligibilityCaller,
): Promise<void> {
  if (lineup.visibility !== 'private') return;
  if (caller.role === 'admin' || caller.role === 'operator') return;
  if (lineup.createdBy === caller.id) return;
  const invited = await isInvitee(db, lineup.id, caller.id);
  if (!invited) {
    throw new ForbiddenException('Not invited to this lineup');
  }
}
