/**
 * Invitee CRUD helpers for community lineups (ROK-1065).
 * Used by the lineups service + controller to manage the invitee roster.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { LineupInviteeResponseDto } from '@raid-ledger/contract';
import { activeUsersFilter } from '../users/users-active.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Caller identity for invitee-management authorization (ROK-1440). */
export interface InviteeManagerCaller {
  id: number;
  role: string;
}

/**
 * Throw unless the caller may manage this lineup's invitee roster
 * (ROK-1440).
 *
 * Previously both invitee routes were `@Roles('operator')`, while the web UI
 * showed the "Invite more" button to `isOperator || viewer === createdBy` —
 * so a non-operator CREATOR saw a button that 403'd. The operator ask is
 * explicitly "poll creator, admin, or operator", which is the same rule
 * `scheduling-remind.service.ts::assertCallerMayRemind` already applies to
 * the sibling Remind-voters action. Mirror it here.
 */
export async function assertCallerMayManageInvitees(
  db: Db,
  lineupId: number,
  caller: InviteeManagerCaller,
): Promise<void> {
  if (caller.role === 'admin' || caller.role === 'operator') return;
  const [lineup] = await db
    .select({ createdBy: schema.communityLineups.createdBy })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.createdBy !== caller.id) {
    throw new ForbiddenException(
      'Only the lineup creator or an operator can manage invitees',
    );
  }
}

/**
 * Insert new invitees. Probes the users table first so unknown IDs surface
 * as a 404 instead of a 500 FK violation. `ON CONFLICT DO NOTHING` makes
 * the operation idempotent when an invitee already exists.
 */
export async function addInvitees(
  db: Db,
  lineupId: number,
  userIds: number[],
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = Array.from(new Set(userIds));
  const found = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.id, unique), activeUsersFilter()));
  const foundIds = new Set(found.map((r) => r.id));
  const missing = unique.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new NotFoundException(`Unknown user id(s): ${missing.join(', ')}`);
  }
  await db
    .insert(schema.communityLineupInvitees)
    .values(unique.map((userId) => ({ lineupId, userId })))
    .onConflictDoNothing({
      target: [
        schema.communityLineupInvitees.lineupId,
        schema.communityLineupInvitees.userId,
      ],
    });
}

/** Remove a single invitee from a lineup. */
export async function removeInvitee(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<void> {
  await db
    .delete(schema.communityLineupInvitees)
    .where(
      and(
        eq(schema.communityLineupInvitees.lineupId, lineupId),
        eq(schema.communityLineupInvitees.userId, userId),
      ),
    );
}

/**
 * Load invitees with display name + steam-linked flag for the detail
 * response. Steam linkage is derived from `users.steam_id IS NOT NULL`.
 */
export async function listInviteesWithProfile(
  db: Db,
  lineupId: number,
): Promise<LineupInviteeResponseDto[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      displayName:
        sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`.as(
          'display_name',
        ),
      steamId: schema.users.steamId,
    })
    .from(schema.communityLineupInvitees)
    .innerJoin(
      schema.users,
      eq(schema.communityLineupInvitees.userId, schema.users.id),
    )
    .where(
      and(
        eq(schema.communityLineupInvitees.lineupId, lineupId),
        activeUsersFilter(),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    steamLinked: !!r.steamId,
  }));
}
