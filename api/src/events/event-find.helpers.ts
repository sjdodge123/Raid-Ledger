/**
 * Helpers for event lookup queries (findOne, findByIds).
 */
import { eq, sql, and, ne, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { NotFoundException } from '@nestjs/common';

/** Row shape returned by event queries with joined data. */
export type EventRow = {
  events: typeof schema.events.$inferSelect;
  users: typeof schema.users.$inferSelect | null;
  games: typeof schema.games.$inferSelect | null;
  signupCount: number;
};

/** Fetches a single event with creator/game joins, or throws. */
export async function findOneEvent(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<EventRow> {
  const results = await db
    .select({
      events: schema.events,
      users: schema.users,
      games: schema.games,
      signupCount: sql<number>`coalesce((
        SELECT count(*) FROM event_signups WHERE event_id = ${schema.events.id} AND status != 'roached_out' AND status != 'departed' AND status != 'declined'
      ), 0)`,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .where(eq(schema.events.id, id))
    .limit(1);
  if (results.length === 0) {
    throw new NotFoundException(`Event with ID ${id} not found`);
  }
  return results[0];
}

/** Builds a signup count subquery filtered by the given event IDs. */
function buildSignupCountSubquery(
  db: PostgresJsDatabase<typeof schema>,
  ids: number[],
) {
  return db
    .select({
      eventId: schema.eventSignups.eventId,
      count: sql<number>`count(*)`.as('signup_count'),
    })
    .from(schema.eventSignups)
    .where(
      and(
        inArray(schema.eventSignups.eventId, ids),
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'departed'),
        ne(schema.eventSignups.status, 'declined'),
      ),
    )
    .groupBy(schema.eventSignups.eventId)
    .as('signup_counts');
}

/** Fetches multiple events by IDs with creator/game joins. */
export async function findEventsByIds(
  db: PostgresJsDatabase<typeof schema>,
  ids: number[],
): Promise<EventRow[]> {
  if (ids.length === 0) return [];
  const sq = buildSignupCountSubquery(db, ids);
  return db
    .select({
      events: schema.events,
      users: schema.users,
      games: schema.games,
      signupCount: sql<number>`coalesce(${sq.count}, 0)`,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .leftJoin(sq, eq(schema.events.id, sq.eventId))
    .where(inArray(schema.events.id, ids));
}
