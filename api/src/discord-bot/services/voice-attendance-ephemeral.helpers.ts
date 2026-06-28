/**
 * Ephemeral-channel branch for voice-attendance resolution (ROK-1352).
 *
 * Extracted to its own file (architect guidance #3) so the ~269-line
 * `voice-attendance-flush.helpers.ts` stays under the 300-line cap. Called by
 * `findActiveEventsForChannel` BEFORE the `logUnrecognizedChannel` fallthrough:
 * an ephemeral channel is neither a binding nor the default voice channel, so
 * without this branch attendance would never attach to it.
 */
import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Resolve the event that owns `channelId` as its live ephemeral voice channel,
 * if any, scoped to events that are currently active (started, not past their
 * effective end, not cancelled). Returns [] when the channel is not an
 * ephemeral channel for an active event.
 */
export async function findActiveEventsByEphemeralChannel(
  db: Db,
  channelId: string,
  now: Date,
): Promise<Array<{ eventId: number; gameId: number | null }>> {
  const rows = await db
    .select({ id: schema.events.id, gameId: schema.events.gameId })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.ephemeralVoiceChannelId, channelId),
        sql`${schema.events.cancelledAt} IS NULL`,
        sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
      ),
    );
  return rows.map((e) => ({ eventId: e.id, gameId: e.gameId }));
}
