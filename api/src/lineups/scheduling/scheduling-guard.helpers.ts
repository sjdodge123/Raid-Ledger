/**
 * Scheduling-mutation guards (ROK-1302).
 *
 * Extracted from SchedulingService to keep that file under the 300-line limit.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { findSlotOrThrow } from './scheduling-event.helpers';

type Db = PostgresJsDatabase<typeof schema>;

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
