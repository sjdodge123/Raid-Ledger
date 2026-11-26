/**
 * ROK-1573 — create an event from a live LFG group and convert the group.
 *
 * Runs inside `POST /events`, BEFORE the creator's signup: the signup listener
 * clears the creator's `active` intent, after which the creator would no
 * longer be a live holder and the provenance would be lost (spec "Critical
 * verified finding").
 */
import { ConflictException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  LfgLockInPatch,
  LfgSignupCarryover,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import type { LfgGroupScope } from './lfg-group-scope.helpers';
import {
  buildGroupLockInPatch,
  clearNowSiblings,
  LFG_FOLD_LOCK_IN,
  liveLockInRows,
  type LfgLockInGroup,
} from './lfg-lock-in-group.helpers';
import type { LfgDb } from './lfg-query.helpers';
import { lfgGroupLockKey } from './lfg.constants';

/** 409 body when the caller's group is gone (review P2-2). */
export const LFG_GROUP_GONE_MESSAGE =
  'This group was already scheduled or you are no longer in it.';

/** What a successful group create hands back. */
export interface LfgGroupCreateResult<T> {
  event: T;
  /** Every converted member (includes the creator). */
  memberIds: number[];
  /** ROK-2352: userId → character/roles from the adapter (grouped games). */
  carryover?: LfgSignupCarryover;
  /** ROK-2352 Q1: members whose `now` hand in another group was cleared. */
  clearedSiblingUserIds?: number[];
}

/** What the event create receives from the grouping adapter, if any. */
export type LfgEventPatch = Omit<LfgLockInPatch, 'carryover'>;

/** True when the caller holds a LIVE hand in the group (`scope`). */
async function holdsLiveIntent(
  tx: LfgDb,
  userId: number,
  gameId: number,
  scope: LfgGroupScope,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.lfgIntents.id })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        liveLockInRows(tx, gameId, scope, new Date()),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Flip every live intent of the group (`scope`; null = the whole game) to
 * `converted` → this event. Signs up EVERY live member regardless of their
 * game time (operator ruling).
 */
async function convertLiveRows(
  tx: LfgDb,
  gameId: number,
  eventId: number,
  scope: LfgGroupScope,
): Promise<number[]> {
  const rows = await tx
    .update(schema.lfgIntents)
    .set({
      status: 'converted',
      convertedToPollId: null,
      convertedToEventId: eventId,
      convertedAt: sql`statement_timestamp()`, // TDB:953 — DB clock at the UPDATE, not tx start
    })
    .where(liveLockInRows(tx, gameId, scope, new Date()))
    .returning({ userId: schema.lfgIntents.userId });
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Check → create → convert, serialized per game by the group advisory lock.
 *
 * The lock is held by this transaction from BEFORE the live-intent check
 * until the conversion commits, so of two concurrent Lock-ins exactly one
 * passes the check; the other waits, then finds the group converted and gets
 * a 409 without creating anything.
 *
 * Why `createEvent` runs on its own connection (not `tx`): the create emits
 * `event.created` and its listeners (Discord embed, notifications) read the
 * event on other connections — an uncommitted insert would be invisible to
 * them. The event therefore commits first, still inside the lock window. If
 * the conversion UPDATE then fails, the caller is told (the event exists) so
 * it can fall back to a plain event rather than a 500.
 *
 * @param db - Drizzle handle.
 * @param userId - The event creator; must hold a live intent on `gameId`.
 * @param gameId - Game whose group is converting.
 * @param createEvent - Creates the event (only called after the check),
 *   given the grouping adapter's roster / instance / title when there is one.
 * @param group - ROK-2352: the group converting (default: the whole game).
 *   Only that group's hands convert; its members' other `now` hands in the
 *   game are cleared in the same transaction (Q1).
 * @returns The created event and the converted members.
 * @throws ConflictException when the caller holds no live intent.
 */
export function createAndConvertGroup<T extends { id: number }>(
  db: LfgDb,
  userId: number,
  gameId: number,
  createEvent: (patch?: LfgEventPatch) => Promise<T>,
  group: LfgLockInGroup = LFG_FOLD_LOCK_IN,
): Promise<LfgGroupCreateResult<T>> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
    );
    if (!(await holdsLiveIntent(tx, userId, gameId, group.scope))) {
      throw new ConflictException(LFG_GROUP_GONE_MESSAGE);
    }
    const patch = await buildGroupLockInPatch(tx, gameId, group);
    if (patch === undefined) {
      const event = await createEvent();
      const memberIds = await convertLiveRows(tx, gameId, event.id, null);
      return { event, memberIds };
    }
    const { carryover, ...eventPatch } = patch;
    const event = await createEvent(eventPatch);
    const memberIds = await convertLiveRows(tx, gameId, event.id, group.scope);
    const clearedSiblingUserIds = await clearNowSiblings(tx, gameId, memberIds);
    return { event, memberIds, carryover, clearedSiblingUserIds };
  });
}
