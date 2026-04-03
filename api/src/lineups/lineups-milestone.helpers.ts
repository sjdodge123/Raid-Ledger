/**
 * Nomination milestone detection for notification dispatch (ROK-932).
 * Checks if the current entry count crosses a 25/50/100% threshold.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  countLineupEntries,
  countDistinctNominators,
} from './lineups-query.helpers';
import { nominationCap } from './common-ground-scoring.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** Milestone thresholds as percentages. */
const THRESHOLDS = [25, 50, 100];

/** Result of a milestone check. */
export interface MilestoneResult {
  threshold: number;
  entryCount: number;
}

/**
 * Check if the current entry count crosses a milestone threshold.
 * Returns the crossed threshold, or null if no milestone was hit.
 *
 * @param db - Database connection
 * @param lineupId - The lineup to check
 * @returns The milestone that was crossed, or null
 */
export async function checkNominationMilestone(
  db: Db,
  lineupId: number,
): Promise<MilestoneResult | null> {
  const [[entries], [nominators]] = await Promise.all([
    countLineupEntries(db, lineupId),
    countDistinctNominators(db, lineupId),
  ]);

  const cap = nominationCap(nominators?.count ?? 0);
  const count = entries?.count ?? 0;
  if (cap === 0) return null;

  const pct = (count / cap) * 100;

  for (const t of THRESHOLDS) {
    const prevCount = count - 1;
    const prevPct = cap > 0 ? (prevCount / cap) * 100 : 0;
    if (pct >= t && prevPct < t) {
      return { threshold: t, entryCount: count };
    }
  }

  return null;
}

/** Entry detail for milestone embeds. */
export interface EntryDetail {
  gameId: number;
  gameName: string;
  nominatorName: string;
  coverUrl: string | null;
}

/** Get game + nominator details for all entries in a lineup. */
export async function getEntryDetails(
  db: Db,
  lineupId: number,
): Promise<EntryDetail[]> {
  const rows = await db
    .select({
      gameId: schema.games.id,
      gameName: schema.games.name,
      nominatorName: schema.users.displayName,
      coverUrl: schema.games.coverUrl,
    })
    .from(schema.communityLineupEntries)
    .innerJoin(
      schema.games,
      eq(schema.communityLineupEntries.gameId, schema.games.id),
    )
    .innerJoin(
      schema.users,
      eq(schema.communityLineupEntries.nominatedBy, schema.users.id),
    )
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return rows.map((r) => ({
    gameId: r.gameId,
    gameName: r.gameName,
    nominatorName: r.nominatorName ?? 'Unknown',
    coverUrl: r.coverUrl,
  }));
}
