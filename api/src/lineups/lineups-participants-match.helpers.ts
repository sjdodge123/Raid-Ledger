/**
 * Match-scoped participant roster sources (ROK-1557).
 *
 * `GET /lineups/:id/participants` without `?matchId` answers the NOMINATION
 * phase: it derives `status` from `community_lineup_votes` and builds its
 * candidate set from invitees / nominators / voters. A standalone scheduling
 * poll has none of those rows, so every member read `waiting` forever and the
 * roster listed the wrong people.
 *
 * When `?matchId` is given the roster is answered from the SCHEDULING poll
 * instead:
 *   - candidates = creator ∪ match members ∪ schedule voters
 *   - `voted` = the user cast a schedule-slot vote on one of THIS match's slots
 *   - `nominated` is impossible (a poll has no nominations), so the set is empty
 *   - role precedence is unchanged (creator > invitee > participant)
 *
 * Terminal polls need no special casing: votes persist after lock-in /
 * cancellation / expiry, so the final roster state persists with them.
 */
import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The classification sets that drive `deriveRole` / `deriveStatus`. */
export interface RosterSources {
  creatorId: number;
  inviteeIds: Set<number>;
  nominatorIds: Set<number>;
  voterIds: Set<number>;
}

/** Distinct invitee user IDs for a lineup (private lineups + role precedence). */
export async function loadInviteeIds(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: schema.communityLineupInvitees.userId })
    .from(schema.communityLineupInvitees)
    .where(eq(schema.communityLineupInvitees.lineupId, lineupId));
  return rows.map((r) => r.userId);
}

/**
 * Assert the match belongs to the lineup. 404 otherwise — a match id from a
 * DIFFERENT lineup must never leak that lineup's roster.
 */
async function assertMatchInLineup(
  db: Db,
  lineupId: number,
  matchId: number,
): Promise<void> {
  const [match] = await db
    .select({ id: schema.communityLineupMatches.id })
    .from(schema.communityLineupMatches)
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        eq(schema.communityLineupMatches.lineupId, lineupId),
      ),
    )
    .limit(1);
  if (!match) throw new NotFoundException('Match not found');
}

/**
 * Distinct user IDs that ANSWERED any schedule slot of this match.
 *
 * ROK-1617: deliberately both stances. This set feeds `deriveStatus`
 * (`lineups-participants.helpers.ts:91`), whose vocabulary is `voted` vs
 * `waiting` — engagement with the poll, not who will play. A member who said
 * "none of these times work" has answered; filtering them to YES would park
 * them on `waiting` forever and have the organiser chase a reply they gave.
 */
async function loadScheduleVoterIds(
  db: Db,
  matchId: number,
): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: schema.communityLineupScheduleVotes.userId })
    .from(schema.communityLineupScheduleVotes)
    .innerJoin(
      schema.communityLineupScheduleSlots,
      eq(
        schema.communityLineupScheduleVotes.slotId,
        schema.communityLineupScheduleSlots.id,
      ),
    )
    .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
  return rows.map((r) => r.userId);
}

/** Distinct user IDs enrolled as members of this match. */
async function loadMatchMemberIds(db: Db, matchId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: schema.communityLineupMatchMembers.userId })
    .from(schema.communityLineupMatchMembers)
    .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
  return rows.map((r) => r.userId);
}

/**
 * Deduped candidate roster for a poll: creator first, then match members,
 * then anyone who voted without being enrolled. Pure — unit tested.
 */
export function collectMatchCandidateIds(
  creatorId: number,
  memberIds: Iterable<number>,
  voterIds: Iterable<number>,
): number[] {
  const candidates = new Set<number>([creatorId]);
  for (const id of memberIds) candidates.add(id);
  for (const id of voterIds) candidates.add(id);
  return [...candidates];
}

/**
 * Load the roster sources + candidate set for a scheduling poll.
 *
 * @throws NotFoundException when the match does not belong to the lineup.
 */
export async function loadMatchRosterSources(
  db: Db,
  lineupId: number,
  matchId: number,
  creatorId: number,
): Promise<{ sources: RosterSources; candidateIds: number[] }> {
  await assertMatchInLineup(db, lineupId, matchId);
  const [voterIds, memberIds, inviteeIds] = await Promise.all([
    loadScheduleVoterIds(db, matchId),
    loadMatchMemberIds(db, matchId),
    loadInviteeIds(db, lineupId),
  ]);
  const sources: RosterSources = {
    creatorId,
    inviteeIds: new Set(inviteeIds),
    // A scheduling poll has no nominations, so nobody can read `nominated`.
    nominatorIds: new Set<number>(),
    voterIds: new Set(voterIds),
  };
  return {
    sources,
    candidateIds: collectMatchCandidateIds(creatorId, memberIds, voterIds),
  };
}
