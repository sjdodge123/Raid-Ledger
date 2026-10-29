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
 *    the event id onto the row we claimed. Since nothing else writes a
 *    `scheduled` + unlinked row, its `false` branch is defensive.
 * 3. `releaseMatchClaim` — when the create throws, put the prior status back.
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
): Promise<ClaimedFromStatus> {
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
    await tx.update(m).set({ status: 'scheduled' }).where(eq(m.id, matchId));
    return row.status;
  });
  if (prior !== 'suggested' && prior !== 'scheduling') {
    throw new ConflictException(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE);
  }
  return prior;
}

/**
 * Write the event onto the match this lock-in claimed. False when it moved
 * (defensive: see step 2 above).
 */
export async function linkClaimedMatch(
  db: Writer,
  matchId: number,
  eventId: number,
): Promise<boolean> {
  const linked = await db
    .update(m)
    .set({ linkedEventId: eventId })
    .where(
      and(
        eq(m.id, matchId),
        eq(m.status, 'scheduled'),
        isNull(m.linkedEventId),
      ),
    )
    .returning({ id: m.id });
  return linked.length !== 0;
}

/**
 * Undo a claim whose event was never created. Never throws: the caller is
 * already failing with the create's own error, which must reach the client.
 * `linkedEventId` is the same value the claim was made with (ROK-2040).
 */
export async function releaseMatchClaim(
  db: Db,
  matchId: number,
  prior: ClaimedFromStatus,
  logger: Pick<Logger, 'error'>,
  linkedEventId: number | null = null,
): Promise<void> {
  try {
    await db
      .update(m)
      .set({ status: prior })
      .where(
        and(
          eq(m.id, matchId),
          eq(m.status, 'scheduled'),
          linkIs(linkedEventId),
        ),
      );
  } catch (err: unknown) {
    logger.error(
      `Lock-in claim on match ${matchId} not released: ${String(err)}`,
    );
  }
}
