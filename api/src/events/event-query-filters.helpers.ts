/**
 * Filter condition builders for event list queries.
 */
import { eq, gte, lte, sql, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { EventListQueryDto } from '@raid-ledger/contract';

type Condition = ReturnType<typeof gte>;

/** Adds upcoming/past filter condition. */
function addUpcomingCondition(
  conditions: Condition[],
  upcoming?: string,
): void {
  const now = sql`${new Date().toISOString()}::timestamp`;
  if (upcoming === 'true')
    conditions.push(gte(sql`upper(${schema.events.duration})`, now));
  else if (upcoming === 'false')
    conditions.push(lte(sql`upper(${schema.events.duration})`, now));
}

/** Adds date range filter conditions (startAfter, endBefore). */
function addDateRangeConditions(
  conditions: Condition[],
  query: EventListQueryDto,
): void {
  if (query.startAfter) {
    conditions.push(
      gte(
        sql`lower(${schema.events.duration})`,
        sql`${query.startAfter}::timestamp`,
      ),
    );
  }
  if (query.endBefore) {
    conditions.push(
      lte(
        sql`lower(${schema.events.duration})`,
        sql`${query.endBefore}::timestamp`,
      ),
    );
  }
}

/** Adds entity-related filter conditions (gameId, creatorId, adHoc, signedUpAs). */
function addEntityConditions(
  conditions: Condition[],
  query: EventListQueryDto,
  authenticatedUserId: number | undefined,
): void {
  if (query.gameId) {
    conditions.push(eq(schema.events.gameId, Number(query.gameId)));
  }
  if (query.creatorId) {
    const resolvedCreatorId =
      query.creatorId === 'me' ? authenticatedUserId : Number(query.creatorId);
    if (resolvedCreatorId)
      conditions.push(eq(schema.events.creatorId, resolvedCreatorId));
  }
  if (query.includeAdHoc === 'false') {
    conditions.push(eq(schema.events.isAdHoc, false));
  }
  if (query.signedUpAs && query.signedUpAs === 'me' && authenticatedUserId) {
    const signedUpEventIds = sql`(
      SELECT event_id FROM event_signups
      WHERE user_id = ${authenticatedUserId}
        AND status != 'roached_out'
        AND status != 'departed'
    )`;
    conditions.push(inArray(schema.events.id, signedUpEventIds));
  }
}

/** Builds the full set of filter conditions for an event list query. */
export function buildFilterConditions(
  query: EventListQueryDto,
  authenticatedUserId: number | undefined,
): Condition[] {
  const conditions: Condition[] = [];
  if (query.includeCancelled !== 'true') {
    conditions.push(sql`${schema.events.cancelledAt} IS NULL`);
  }
  conditions.push(sql`${schema.events.reschedulingPollId} IS NULL`);
  addUpcomingCondition(conditions, query.upcoming);
  addDateRangeConditions(conditions, query);
  addEntityConditions(conditions, query, authenticatedUserId);
  return conditions;
}
