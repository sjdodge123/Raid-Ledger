/**
 * ROK-2025 — the organizer's bench pick on a scheduling lock-in.
 *
 * The create form sends `benchUserIds`: exactly the overflow, every one of
 * them a yes-voter of the winning slot. The server re-computes the overflow
 * from the event that now exists (capacity minus occupied spots, D3) and
 * refuses a pick that no longer fits — BEFORE the CAS flip, so a 400 leaves
 * the match `scheduling` and the client can retry without picks (D6).
 */
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  isCancelledStatus,
  resolveEventCapacity,
} from '../../events/signups-signup.helpers';
import { findScheduleVotes } from '../scheduling/scheduling-query.helpers';
import { yesVotesOnly } from '../scheduling/scheduling-stance.helpers';
import { assertCanCompletePoll } from './standalone-poll-auth.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The lock-in a bench pick is checked against. */
export interface BenchPickTarget {
  matchId: number;
  eventId?: number | undefined;
  startTime?: string | undefined;
  benchUserIds?: readonly number[] | undefined;
}

export const BENCH_PICK_NOT_A_VOTER =
  'Only people who voted yes for this time can go to the bench.';
export const BENCH_PICK_DUPLICATE =
  'Each person can only be picked for the bench once.';
export const BENCH_PICK_NOBODY = 'Nobody needs to go to the bench any more.';

/** The wrong-count copy for an overflow of `overflow` (0 has its own line). */
export function benchPickCountMessage(overflow: number): string {
  if (overflow === 0) return BENCH_PICK_NOBODY;
  return `The votes changed while you were choosing. Pick exactly ${overflow} for the bench.`;
}

/** How many candidates do not fit: `capacity === null` = unlimited. */
export function benchPickOverflow(
  capacity: number | null,
  occupied: number,
  candidateCount: number,
): number {
  if (capacity === null) return 0;
  return Math.max(0, candidateCount - Math.max(0, capacity - occupied));
}

/** Throw the exact 400 for a pick that is not the overflow; else its set. */
export function checkBenchPick(
  ids: readonly number[],
  candidates: ReadonlySet<number>,
  overflow: number,
): ReadonlySet<number> {
  const picked = new Set(ids);
  if (picked.size !== ids.length) {
    throw new BadRequestException(BENCH_PICK_DUPLICATE);
  }
  if (ids.some((id) => !candidates.has(id))) {
    throw new BadRequestException(BENCH_PICK_NOT_A_VOTER);
  }
  if (ids.length !== overflow) {
    throw new BadRequestException(benchPickCountMessage(overflow));
  }
  return picked;
}

/** Unique yes-voters of the poll slot at `startTime` (none if no slot). */
async function slotYesVoterIds(
  db: Db,
  matchId: number,
  startTime: string,
): Promise<number[]> {
  const at = new Date(startTime).getTime();
  const slots = await db
    .select({
      id: schema.communityLineupScheduleSlots.id,
      proposedTime: schema.communityLineupScheduleSlots.proposedTime,
    })
    .from(schema.communityLineupScheduleSlots)
    .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
  const slot = slots.find((s) => s.proposedTime.getTime() === at);
  if (!slot) return [];
  const votes = yesVotesOnly(await findScheduleVotes(db, [slot.id]));
  return [...new Set(votes.map((v) => v.userId))];
}

/** Capacity, occupied (non-bench) spots and the users already signed up. */
async function eventRoster(db: Db, eventId: number) {
  const [event] = await db
    .select({
      slotConfig: schema.events.slotConfig,
      maxAttendees: schema.events.maxAttendees,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const rows = await db
    .select({
      userId: schema.eventSignups.userId,
      status: schema.eventSignups.status,
      role: schema.rosterAssignments.role,
    })
    .from(schema.eventSignups)
    .leftJoin(
      schema.rosterAssignments,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(eq(schema.eventSignups.eventId, eventId));
  return {
    capacity: event ? resolveEventCapacity(event) : null,
    // Mirrors checkAutoBench: any roster row that is not the bench.
    occupied: rows.filter((r) => r.role !== null && r.role !== 'bench').length,
    signedUp: new Set(
      rows.filter((r) => !isCancelledStatus(r.status)).map((r) => r.userId),
    ),
  };
}

/**
 * Validate the organizer's pick. Returns `undefined` when no pick was sent
 * (old client, reschedule lock) — the server then benches the latest voters.
 */
export async function assertBenchPick(
  db: Db,
  target: BenchPickTarget,
): Promise<ReadonlySet<number> | undefined> {
  const { matchId, eventId, startTime, benchUserIds } = target;
  if (!benchUserIds || eventId === undefined || startTime === undefined) {
    return undefined;
  }
  const voters = await slotYesVoterIds(db, matchId, startTime);
  const roster = await eventRoster(db, eventId);
  // POST /events signed the creator up, so they are never a candidate.
  const candidates = new Set(voters.filter((id) => !roster.signedUp.has(id)));
  const overflow = benchPickOverflow(
    roster.capacity,
    roster.occupied,
    candidates.size,
  );
  return checkBenchPick(benchUserIds, candidates, overflow);
}

/**
 * The pre-flip checks of `complete()`: ROK-1844 authz/target validation, then
 * the ROK-2025 bench pick. Both run before the CAS flip, so a refusal leaves
 * the match `scheduling`. Returns the validated pick (undefined = none sent).
 */
export async function assertCanCompleteWithBench(
  db: Db,
  caller: { id: number; isAdmin: boolean },
  target: BenchPickTarget,
): Promise<ReadonlySet<number> | undefined> {
  const { matchId, eventId, startTime } = target;
  await assertCanCompletePoll(db, matchId, caller, { eventId, startTime });
  return assertBenchPick(db, target);
}
