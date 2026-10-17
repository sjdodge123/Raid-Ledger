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
import { activeUsersFilter } from '../users/users-active.helpers';

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
 * Return every *active* user ID pinned as an invitee on the given lineup.
 * Empty array for public lineups (invitees are only meaningful for private).
 *
 * ROK-1412: inner-joins `users` + `activeUsersFilter()` so invitees who left
 * the guild (auto-deactivated, `deactivated_at` set) drop out of every
 * people-denominator this feeds — the banner `votingEligibleCount`, the
 * common-ground participant count, and the AI voter scope. This mirrors the
 * detail-path `listInviteesWithProfile`, which already filtered, so banner and
 * detail counts stay in parity. Invitee rows are preserved untouched, so
 * reactivation (clearing `deactivated_at`) restores eligibility automatically —
 * no migration. The filter is deactivation-only (NOT the banned/kicked
 * REACHABLE predicate); ROK-313 ban semantics are out of scope here.
 */
export async function loadInvitees(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.communityLineupInvitees.userId })
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
  return rows.map((r) => r.userId);
}

/**
 * True when the caller is an *active* member of the lineup's invitee list (a
 * plain invitee, not counting the creator or admin/operator roles).
 *
 * ROK-1412: a deactivated invitee is treated as "not invited" — the same
 * `users` inner-join + `activeUsersFilter()` used by `loadInvitees`. Their
 * invitee row is preserved, so reactivation restores this to `true` with no
 * data change. Deactivation-only (not banned/kicked — out of scope).
 */
export async function isInvitee(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.communityLineupInvitees.id })
    .from(schema.communityLineupInvitees)
    .innerJoin(
      schema.users,
      eq(schema.communityLineupInvitees.userId, schema.users.id),
    )
    .where(
      and(
        eq(schema.communityLineupInvitees.lineupId, lineupId),
        eq(schema.communityLineupInvitees.userId, userId),
        activeUsersFilter(),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Throw ForbiddenException when the caller may not participate
 * (nominate / vote / bandwagon-join) on a private lineup. Public lineups
 * always pass.
 *
 * ROK-1412: delegates to `isInvitee`, so a deactivated invitee is rejected
 * (403) exactly like a non-invitee. Reactivation restores participation
 * automatically because the invitee row is never deleted on deactivation.
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
