/**
 * Per-match lock-in claim (ROK-2024 follow-up F2).
 *
 * The expired-poll lock-in used to create its event FIRST and only then try
 * the link compare-and-set, so the loser of two concurrent lock-ins left an
 * orphaned event that was already on Discord. It now CLAIMS the match before
 * creating anything, and the claim is a committed row state, not a held lock:
 *
 * 1. `claimMatchForLockIn` — one short transaction: `SELECT … FOR UPDATE` the
 *    still-unclaimed match, then flip it to `scheduled` with no linked event
 *    yet. It commits before the event is created, so NO pooled connection is
 *    held across `EventsService.create` (which queries through the outer pool:
 *    holding one here would hang every lock-in at `DB_POOL_MAX=1`, and N
 *    concurrent lock-ins would exhaust a pool of N — Codex P1). A second
 *    expired-path caller finds the row no longer `suggested`/`scheduling` and
 *    409s with no event made; so does an open-path `complete`, whose flip
 *    requires `status = 'scheduling'`. A cancel cannot move the claimed row
 *    either: it archives only `scheduling`/`suggested`, so a cancel during
 *    the claim window is a no-op that still returns success, and the poll
 *    locks in anyway (`scheduling-cancel.helpers`).
 * 2. `linkClaimedMatch` — after the create, a single compare-and-set writes
 *    the event id onto the row we claimed. Its `false` branch fires when the
 *    claim was recovered (ROK-2033) while this request was still running.
 * 3. `releaseMatchClaim` — when the create throws, put the prior status back.
 *
 * ROK-2033: the claim also stamps `lock_in_claimed_at` (an app-side `Date`,
 * returned in the `LockInClaim`); the link write clears it in the same
 * statement that sets `linked_event_id`, and both link and release are fenced
 * on it. So a stamped row is a claim that never linked (a crash orphan the
 * recovery sweep may release), a deliberately deleted event leaves the stamp
 * NULL (never reopened), and a stale request can never link or release a
 * later claim. A reschedule claim (ROK-2040, already linked) is not stamped.
 *
 * `scheduled` with a null `linked_event_id` is already a legal state (the
 * link FK is `ON DELETE SET NULL`), so a reader that sees the claim mid-flight
 * sees nothing new.
 */
import { ConflictException, type Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** A handle that can run the link write: the pool or an open transaction. */
type Writer = Pick<Db, 'update'>;

/** The statuses a match may be locked in from. */
const CLAIMABLE = ['suggested', 'scheduling'] as const;

/** The status the match had before the claim (restored on a failed create). */
export type ClaimedFromStatus = (typeof CLAIMABLE)[number];

/**
 * A committed claim (ROK-2033). `claimedAt` is the fencing token written to
 * `lock_in_claimed_at`; `null` for a reschedule claim, which is not stamped.
 * Pass the whole value back to `releaseMatchClaim` / `linkClaimedMatch`.
 */
export interface LockInClaim {
  prior: ClaimedFromStatus;
  claimedAt: Date | null;
}

const m = schema.communityLineupMatches;

/**
 * The link the claimed row must carry: none for a lock-in that will create
 * its event, the poll's own event for a reschedule lock-in (ROK-2040).
 */
function linkIs(linkedEventId: number | null) {
  return linkedEventId === null
    ? isNull(m.linkedEventId)
    : eq(m.linkedEventId, linkedEventId);
}

/** The row still carries this claim's token (ROK-2033 fence). */
function tokenIs(claimedAt: Date | null) {
  return claimedAt === null
    ? isNull(m.lockInClaimedAt)
    : eq(m.lockInClaimedAt, claimedAt);
}

/**
 * Claim the match for this lock-in, or 409 when it is already locked in (or
 * being locked in). Commits before returning; holds nothing afterwards.
 *
 * @param claimable - The statuses this door may claim from. The expired path
 *   keeps the default (`suggested` + `scheduling`); the create-form lock-in
 *   (ROK-2032 D2) passes `['scheduling']` only.
 * @param linkedEventId - ROK-2040: a reschedule poll is already linked to the
 *   event it moves; pass that id so the claim matches the linked row. The
 *   default (`null`) claims only an unlinked match.
 */
export async function claimMatchForLockIn(
  db: Db,
  matchId: number,
  claimable: readonly ClaimedFromStatus[] = CLAIMABLE,
  linkedEventId: number | null = null,
): Promise<LockInClaim> {
  // App-side Date, not SQL now(): postgres.js round-trips milliseconds only,
  // so a µs-precision now() stamp would never equal the token we compare on.
  const claimedAt = linkedEventId === null ? new Date() : null;
  const prior = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: m.status })
      .from(m)
      .where(
        and(
          eq(m.id, matchId),
          inArray(m.status, [...claimable]),
          linkIs(linkedEventId),
        ),
      )
      .for('update');
    if (!row) return null;
    await tx
      .update(m)
      .set({ status: 'scheduled', lockInClaimedAt: claimedAt })
      .where(eq(m.id, matchId));
    return row.status;
  });
  if (prior !== 'suggested' && prior !== 'scheduling') {
    throw new ConflictException(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE);
  }
  return { prior, claimedAt };
}

/**
 * Write the event onto the match this lock-in claimed and clear the claim
 * stamp in the same statement (ROK-2033). False when the row moved or now
 * carries another claim's token — e.g. recovery released it and a second
 * lock-in reclaimed it — so a late link can never land on someone else's
 * claim; the caller discards its events and 409s.
 */
export async function linkClaimedMatch(
  db: Writer,
  matchId: number,
  eventId: number,
  claimedAt: Date | null,
): Promise<boolean> {
  const linked = await db
    .update(m)
    .set({ linkedEventId: eventId, lockInClaimedAt: null })
    .where(
      and(
        eq(m.id, matchId),
        eq(m.status, 'scheduled'),
        isNull(m.linkedEventId),
        tokenIs(claimedAt),
      ),
    )
    .returning({ id: m.id });
  return linked.length !== 0;
}

/**
 * Undo a claim whose event was never created. Never throws: the caller is
 * already failing with the create's own error, which must reach the client.
 * `linkedEventId` is the same value the claim was made with (ROK-2040).
 * Fenced on the claim's token and clears it (ROK-2033), so a request whose
 * claim was already recovered cannot release a newer claim.
 */
export async function releaseMatchClaim(
  db: Db,
  matchId: number,
  claim: LockInClaim,
  logger: Pick<Logger, 'error'>,
  linkedEventId: number | null = null,
): Promise<void> {
  try {
    await db
      .update(m)
      .set({ status: claim.prior, lockInClaimedAt: null })
      .where(
        and(
          eq(m.id, matchId),
          eq(m.status, 'scheduled'),
          linkIs(linkedEventId),
          tokenIs(claim.claimedAt),
        ),
      );
  } catch (err: unknown) {
    logger.error(
      `Lock-in claim on match ${matchId} not released: ${String(err)}`,
    );
  }
}
