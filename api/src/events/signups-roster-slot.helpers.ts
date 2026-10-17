/**
 * Roster slot-assignment write helpers (ROK-1345).
 * Bounded-retry insert that survives the `unique_slot_per_event` race when
 * concurrent signups compute the same next position. Split from
 * signups-roster-query.helpers.ts for the 300-line file limit.
 */
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';
import { findNextPosition } from './signups-roster-query.helpers';

/**
 * Check if a DB error is a unique-constraint violation (PG 23505). Drizzle
 * wraps postgres.PostgresError; SQLSTATE may be on `code` or `cause.code`.
 * Mirrors lineups-nomination.helpers::isUniqueViolation.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e.code === '23505') return true;
  if (e.cause && typeof e.cause === 'object') {
    return (e.cause as Record<string, unknown>).code === '23505';
  }
  return false;
}

export interface RosterSlotInsert {
  eventId: number;
  signupId: number;
  slotRole: string;
  explicitPosition?: number;
  autoBench: boolean;
}

/**
 * Insert one roster row inside a SAVEPOINT (nested tx) so a 23505 rolls back
 * only this insert — otherwise it poisons the outer transaction and every
 * later query fails with "current transaction is aborted".
 */
function insertRosterSlotRow(
  tx: Tx,
  eventId: number,
  signupId: number,
  slotRole: string,
  position: number,
): Promise<unknown> {
  return tx.transaction((sp) =>
    sp
      .insert(schema.rosterAssignments)
      .values({ eventId, signupId, role: slotRole, position, isOverride: 0 }),
  );
}

/**
 * Insert a roster slot row, retrying on the `unique_slot_per_event` race
 * (ROK-1345). Concurrent signups can each compute the same next position via
 * findNextPosition then collide on the partial unique index. On a 23505 we
 * recompute the next free position and retry, up to `maxAttempts`. After the
 * first collision we drop any caller-requested explicit position (it's taken)
 * and let findNextPosition pick the next open slot.
 */
export async function insertRosterSlotWithRetry(
  tx: Tx,
  params: RosterSlotInsert,
  maxAttempts = 3,
): Promise<number> {
  const { eventId, signupId, slotRole, autoBench } = params;
  let explicitPosition = params.explicitPosition;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const position = await findNextPosition(
      tx,
      eventId,
      slotRole,
      explicitPosition,
      autoBench,
    );
    try {
      await insertRosterSlotRow(tx, eventId, signupId, slotRole, position);
      return position;
    } catch (err: unknown) {
      if (!isUniqueViolation(err) || attempt === maxAttempts) throw err;
      // The requested/explicit slot is taken — recompute the next free one.
      explicitPosition = undefined;
    }
  }
  // Unreachable: the loop either returns or throws on the final attempt.
  throw new Error('insertRosterSlotWithRetry: exhausted retries');
}
