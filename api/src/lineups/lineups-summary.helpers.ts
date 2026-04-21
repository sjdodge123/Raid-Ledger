/**
 * Summary helpers for LineupsService.findActive (ROK-1065).
 * Extracted from lineups.service.ts to keep the service file under the
 * 300-line ESLint cap.
 */
import { inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupSummaryResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { findActiveLineups } from './lineups-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Load entry + voter counts for many lineups in two grouped queries.
 * Returns empty maps when no ids are supplied.
 */
async function loadSummaryCounts(
  db: Db,
  lineupIds: number[],
): Promise<{
  entries: Map<number, number>;
  voters: Map<number, number>;
}> {
  if (lineupIds.length === 0) {
    return { entries: new Map(), voters: new Map() };
  }
  const entryRows = await db
    .select({
      lineupId: schema.communityLineupEntries.lineupId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.communityLineupEntries)
    .where(inArray(schema.communityLineupEntries.lineupId, lineupIds))
    .groupBy(schema.communityLineupEntries.lineupId);
  const voterRows = await db
    .select({
      lineupId: schema.communityLineupVotes.lineupId,
      count:
        sql<number>`count(distinct ${schema.communityLineupVotes.userId})::int`.as(
          'count',
        ),
    })
    .from(schema.communityLineupVotes)
    .where(inArray(schema.communityLineupVotes.lineupId, lineupIds))
    .groupBy(schema.communityLineupVotes.lineupId);
  return {
    entries: new Map(entryRows.map((r) => [r.lineupId, r.count])),
    voters: new Map(voterRows.map((r) => [r.lineupId, r.count])),
  };
}

/**
 * Build the array of active lineup summaries returned by GET /lineups/active
 * (ROK-1065). Never filters by viewer — private lineups are read-open.
 */
export async function buildActiveLineupSummaries(
  db: Db,
): Promise<LineupSummaryResponseDto[]> {
  const rows = await findActiveLineups(db);
  const counts = await loadSummaryCounts(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    targetDate: r.targetDate ? r.targetDate.toISOString() : null,
    entryCount: counts.entries.get(r.id) ?? 0,
    totalVoters: counts.voters.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
    visibility: r.visibility,
  }));
}
