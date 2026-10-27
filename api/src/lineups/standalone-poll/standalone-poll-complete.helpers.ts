/**
 * Read side of scheduling-poll completion (ROK-1844), split out of
 * `standalone-poll-query.helpers.ts` to keep that file under the size limit.
 *
 * ROK-2024: completion also accepts a REGULAR lineup match — the web create
 * form locks in an open lineup poll through the same `complete` endpoint.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { assertSlotIsFuture } from '../scheduling/scheduling-lock-in.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The match to complete, with its lineup + linked event state. */
export async function selectCompletionTarget(db: Db, matchId: number) {
  const [match] = await db
    .select({
      id: schema.communityLineupMatches.id,
      lineupId: schema.communityLineupMatches.lineupId,
      linkedEventId: schema.communityLineupMatches.linkedEventId,
      // ROK-1370: the caller must not re-emit UPDATED (which recreates the
      // Discord SE via the cleared-id create branch) for an event that was
      // cancelled mid-poll.
      linkedEventCancelled: sql<boolean>`${schema.events.cancelledAt} IS NOT NULL`,
      // ROK-2024: only a standalone poll archives its lineup on lock-in.
      standalone: sql<boolean>`coalesce(${schema.communityLineups.phaseDurationOverride}->>'standalone' = 'true', false)`,
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.communityLineups,
      eq(schema.communityLineups.id, schema.communityLineupMatches.lineupId),
    )
    .leftJoin(
      schema.events,
      eq(schema.events.id, schema.communityLineupMatches.linkedEventId),
    )
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  return match ?? null;
}

/**
 * ROK-2024 review fix: what a REGULAR lineup match needs before it may flip.
 * Without an event it would turn `scheduled` with no linked event — neither
 * lock-in door could ever finish it again — and, like the expired path
 * (`assertMayLockInSlot`), a time that already passed is refused.
 *
 * @returns The event to link.
 * @throws BadRequestException when `eventId` is missing or `startTime` passed.
 */
export function assertLineupLockIn(
  eventId: number | undefined,
  startTime: string | undefined,
): number {
  if (eventId === undefined) {
    throw new BadRequestException('A lineup poll locks in with an event');
  }
  assertSlotIsFuture(startTime);
  return eventId;
}

/**
 * ROK-2024: lock in a REGULAR lineup match — what `createLockedInEvent` does
 * after it creates the event: compare-and-set `scheduling` → `scheduled` and
 * link the event. The lineup is NOT archived (only standalone polls archive
 * theirs). False when the match was no longer `scheduling` (one-shot).
 */
export async function flipLineupMatch(
  db: Db,
  matchId: number,
  eventId: number,
): Promise<boolean> {
  const flipped = await db
    .update(schema.communityLineupMatches)
    .set({ status: 'scheduled', linkedEventId: eventId })
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        eq(schema.communityLineupMatches.status, 'scheduling'),
      ),
    )
    .returning({ id: schema.communityLineupMatches.id });
  return flipped.length > 0;
}
