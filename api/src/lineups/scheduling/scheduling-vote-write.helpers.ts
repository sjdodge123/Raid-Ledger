/**
 * The ONE write a schedule-slot tap performs (ROK-1617 AC2, ROK-1550).
 *
 * Extracted from `SchedulingService.applyStance` when ROK-1550 added the
 * provenance argument and the service crossed the 300-line ceiling. Nothing
 * about the behaviour moved with it — this is the same insert-first sequence,
 * now reachable without a NestJS module.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ScheduleVoteSource,
  ScheduleVoteStance,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  insertScheduleVote,
  updateScheduleVoteStance,
  findVoteBySlotAndUser,
  deleteScheduleVote,
  ensureMatchMember,
} from './scheduling-query.helpers';
import {
  isAnswering,
  resolveStanceAction,
  type StanceAction,
} from './scheduling-stance.helpers';
import { assertSlotStillVotable } from './scheduling-lock-in.helpers';
import { syncSchedulingSubmittedAt } from './scheduling-submitted-at.helpers';
import { lockMatchMember } from './scheduling-member-lock.helpers';

type Tx = PostgresJsDatabase<typeof schema>;

/**
 * Perform the one write the stance rule calls for.
 *
 * Insert-first keeps ROK-1017's race fix: the INSERT is the probe. Only when
 * it conflicts do we read the existing stance, and even then the write is an
 * UPDATE or a DELETE — never a second row, which `uq_schedule_vote_user`
 * would reject anyway.
 *
 * @param tx - The caller's transaction handle.
 * @param slotId - Slot being answered.
 * @param userId - The voting member.
 * @param stance - The stance pressed.
 * @param source - ROK-1550 provenance, written on the insert AND on the
 *   stance flip, so the row always names the action behind its current
 *   answer. A `cleared` action deletes the row, so it stores nothing.
 * @returns The transition that was applied.
 */
export async function applyStance(
  tx: Tx,
  slotId: number,
  userId: number,
  stance: ScheduleVoteStance,
  source: ScheduleVoteSource,
): Promise<StanceAction> {
  const inserted = await insertScheduleVote(tx, slotId, userId, stance, source);
  if (inserted.length > 0) return resolveStanceAction(null, stance);
  const [existing] = await findVoteBySlotAndUser(tx, slotId, userId);
  // The conflict PROVED a row exists, and we read it in the same
  // transaction, so a missing stance is a pre-stance row — which means
  // 'yes'. Never null here: null would mean "nothing on record" and would
  // make this tap re-insert a row the unique constraint already holds.
  const action = resolveStanceAction(existing?.stance ?? 'yes', stance);
  if (action.kind === 'cleared') {
    // DELETE cannot violate a constraint, so no catch-and-retry is needed.
    await deleteScheduleVote(tx, slotId, userId);
  } else if (action.kind === 'changed') {
    await updateScheduleVoteStance(tx, slotId, userId, action.stance, source);
  }
  return action;
}

/** The slot being tapped — already proven to belong to its match. */
export interface TappedSlot {
  id: number;
  matchId: number;
  proposedTime: Date | string | null | undefined;
}

/**
 * Everything a slot tap writes, inside the caller's transaction: vote write +
 * member enrolment + the ROK-1544 stamp commit atomically, so a partial write
 * can't recreate the voter-without-membership state.
 *
 * ROK-2020 (Codex P2): the `(matchId, userId)` roster lock is the FIRST
 * statement, so a participant removal for this user serialises with the tap
 * instead of interleaving between its vote and membership deletes.
 */
export async function writeSlotTap(
  tx: Tx,
  slot: TappedSlot,
  userId: number,
  stance: ScheduleVoteStance,
  source: ScheduleVoteSource,
): Promise<StanceAction> {
  const { matchId } = slot;
  await lockMatchMember(tx, matchId, userId);
  const resolved = await applyStance(tx, slot.id, userId, stance, source);
  // ROK-1607/1617: a passed time can't be answered, but can be UN-answered.
  // Throwing rolls the write back; the statement itself succeeded, so
  // nothing is poisoned.
  if (isAnswering(resolved)) {
    assertSlotStillVotable(slot.proposedTime);
    await ensureMatchMember(tx, matchId, userId);
  }
  // The tap IS the submit — last statement, so it sees this tx's own write.
  await syncSchedulingSubmittedAt(tx, matchId, userId);
  return resolved;
}
