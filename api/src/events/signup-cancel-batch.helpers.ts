import { and, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { SignupsRosterService } from './signups-roster.service';

const logger = new Logger('SignupCancelBatch');

/**
 * Cancel every upcoming-event signup for the given user via the existing
 * `SignupsRosterService.cancel()` pipeline (ROK-1260).
 *
 * "Upcoming" = the event's duration upper bound is strictly in the future.
 * "Active" = signup status is NOT one of `declined`, `roached_out`,
 * `departed` (matches `buildActiveFilter` in `signup-cancel.helpers.ts`).
 *
 * The loop is sequential with per-signup try/catch — a failure on signup
 * N does not orphan signups N+1..M. We accept `rosterService.cancel`'s
 * own idempotency: a re-run on an already-cancelled signup is a no-op.
 */
export async function cancelAllUpcomingSignupsForUser(
  db: PostgresJsDatabase<typeof schema>,
  rosterService: SignupsRosterService,
  userId: number,
): Promise<number> {
  const upcoming = await db
    .select({ eventId: schema.eventSignups.eventId })
    .from(schema.eventSignups)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventSignups.eventId))
    .where(
      and(
        eq(schema.eventSignups.userId, userId),
        gt(sql`upper(${schema.events.duration})`, sql`NOW()`),
        notInArray(schema.eventSignups.status, [
          'declined',
          'roached_out',
          'departed',
        ]),
      ),
    );
  if (upcoming.length === 0) return 0;
  let cancelled = 0;
  for (const row of upcoming) {
    try {
      await rosterService.cancel(row.eventId, userId);
      cancelled++;
    } catch (err: unknown) {
      logger.warn(
        `ROK-1260: cancel of upcoming signup event=${row.eventId} user=${userId} failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }
  return cancelled;
}

/** Re-export of `inArray` so consumers in tests can reuse the predicate. */
export { inArray };
