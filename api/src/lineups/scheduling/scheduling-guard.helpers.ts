/**
 * Scheduling-mutation guards (ROK-1302).
 *
 * Extracted from SchedulingService to keep that file under the 300-line limit.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { findSlotOrThrow } from './scheduling-event.helpers';
import { assertUserCanParticipate } from '../lineups-eligibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Enforce private-lineup participation on scheduling mutations (vote /
 * suggest). Public lineups (incl. every standalone poll) pass; private
 * lineups are scoped to creator + invitees + admin/operator — mirroring
 * nominate, game-vote, and bandwagon-join, which all run
 * `assertUserCanParticipate`. Without this, a URL-holder could vote on a
 * private lineup's poll and (since voting enrolls) persist themselves into
 * its participant list.
 */
export async function assertCallerMayVote(
  db: Db,
  lineupId: number,
  caller: { id: number; role?: string },
): Promise<void> {
  const [lineup] = await db
    .select({
      id: schema.communityLineups.id,
      createdBy: schema.communityLineups.createdBy,
      visibility: schema.communityLineups.visibility,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) throw new NotFoundException('Lineup not found');
  await assertUserCanParticipate(db, lineup, caller);
}

/** A match still accepts scheduling changes while suggested or scheduling. */
export function assertSchedulable(match: { status: string }): void {
  if (match.status !== 'scheduling' && match.status !== 'suggested') {
    throw new BadRequestException('This match is no longer accepting changes');
  }
}

/**
 * Refuse a scheduling action when the parent lineup opted out of the scheduling
 * phase. The decided matches stay `suggested` (so `assertSchedulable` alone
 * would let a hand-crafted matchId suggest a slot, auto-vote, and create an
 * event), so every scheduling mutation additionally verifies the PARENT lineup
 * still has scheduling enabled. The flag is joined into the match row by
 * `findMatchById` (ROK-1302) — no extra query. 404s — the whole scheduling
 * surface is "absent" for opted-out lineups, matching `getSchedulePoll`.
 */
export function assertSchedulingEnabled(match: {
  includeSchedulingPhase?: boolean | null;
}): void {
  if (match.includeSchedulingPhase === false) {
    throw new NotFoundException('Scheduling is disabled for this lineup');
  }
}

const DUPLICATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Refuse a suggested slot within 15 minutes of an existing one. */
export async function assertNoDuplicateSlot(
  db: Db,
  matchId: number,
  proposed: Date,
): Promise<void> {
  const windowStart = new Date(proposed.getTime() - DUPLICATE_WINDOW_MS);
  const windowEnd = new Date(proposed.getTime() + DUPLICATE_WINDOW_MS);
  const [dup] = await db
    .select({ id: schema.communityLineupScheduleSlots.id })
    .from(schema.communityLineupScheduleSlots)
    .where(
      and(
        eq(schema.communityLineupScheduleSlots.matchId, matchId),
        gte(schema.communityLineupScheduleSlots.proposedTime, windowStart),
        lte(schema.communityLineupScheduleSlots.proposedTime, windowEnd),
      ),
    )
    .limit(1);
  if (dup)
    throw new BadRequestException('A slot within 15 minutes already exists');
}

/**
 * Assert the slot exists AND belongs to the given match. The state guards
 * above run against the URL's match, so a body slotId from a different match
 * must be rejected or a vote could land on a poll whose state was never
 * checked.
 */
export async function assertSlotBelongsToMatch(
  db: Db,
  slotId: number,
  matchId: number,
): Promise<void> {
  const slot = await findSlotOrThrow(db, slotId);
  if (slot.matchId !== matchId) {
    throw new NotFoundException('Slot not found in this match');
  }
}
