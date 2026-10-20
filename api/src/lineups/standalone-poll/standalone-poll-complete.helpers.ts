/**
 * Read side of standalone-poll completion (ROK-1844), split out of
 * `standalone-poll-query.helpers.ts` to keep that file under the size limit.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The standalone match to complete, with its lineup + linked event state. */
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
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        sql`${schema.communityLineups.phaseDurationOverride}->>'standalone' = 'true'`,
      ),
    )
    .limit(1);
  return match ?? null;
}
