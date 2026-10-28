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
 *    requires `status = 'scheduling'`.
 * 2. `linkClaimedMatch` — after the create, a single compare-and-set writes
 *    the event id onto the row we claimed.
 * 3. `releaseMatchClaim` — when the create throws, put the prior status back.
 *
 * `scheduled` with a null `linked_event_id` is already a legal state (the
 * link FK is `ON DELETE SET NULL`), so a reader that sees the claim mid-flight
 * sees nothing new.
 */
import { ConflictException, type Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The statuses a match may be locked in from. */
const CLAIMABLE = ['suggested', 'scheduling'] as const;

/** The status the match had before the claim (restored on a failed create). */
export type ClaimedFromStatus = (typeof CLAIMABLE)[number];

const m = schema.communityLineupMatches;

/**
 * Claim the match for this lock-in, or 409 when it is already locked in (or
 * being locked in). Commits before returning; holds nothing afterwards.
 */
export async function claimMatchForLockIn(
  db: Db,
  matchId: number,
): Promise<ClaimedFromStatus> {
  const prior = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: m.status })
      .from(m)
      .where(
        and(
          eq(m.id, matchId),
          inArray(m.status, [...CLAIMABLE]),
          isNull(m.linkedEventId),
        ),
      )
      .for('update');
    if (!row) return null;
    await tx.update(m).set({ status: 'scheduled' }).where(eq(m.id, matchId));
    return row.status;
  });
  if (prior !== 'suggested' && prior !== 'scheduling') {
    throw new ConflictException('This poll has already been locked in');
  }
  return prior;
}

/** Write the event onto the match this lock-in claimed. False when it moved. */
export async function linkClaimedMatch(
  db: Db,
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
 */
export async function releaseMatchClaim(
  db: Db,
  matchId: number,
  prior: ClaimedFromStatus,
  logger: Pick<Logger, 'error'>,
): Promise<void> {
  try {
    await db
      .update(m)
      .set({ status: prior })
      .where(
        and(
          eq(m.id, matchId),
          eq(m.status, 'scheduled'),
          isNull(m.linkedEventId),
        ),
      );
  } catch (err: unknown) {
    logger.error(
      `Lock-in claim on match ${matchId} not released: ${String(err)}`,
    );
  }
}
