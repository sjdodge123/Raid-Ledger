import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** How many past winners the curator prompt sees. */
const WINNER_HISTORY_WINDOW = 5;

/**
 * Past-winner context the LLM uses to avoid repeating genre patterns.
 *
 * The candidate pool already EXCLUDES recent winners (so the LLM
 * cannot pick them), but surfacing their NAMES + TAGS lets the LLM
 * say "I'm skipping another fighting-style pick because 3 of the last
 * 5 winners were fighters" — variety reasoning a formula can't do.
 */
export interface RecentWinner {
  gameId: number;
  name: string;
  tags: string[];
}

/**
 * Load up to N most-recently-decided lineups' winning games with
 * their ITAD tags. Returned newest-first.
 */
export async function loadRecentWinners(
  db: Db,
): Promise<RecentWinner[]> {
  const rows = await db
    .select({
      gameId: schema.games.id,
      name: schema.games.name,
      tags: schema.games.itadTags,
    })
    .from(schema.communityLineups)
    .innerJoin(
      schema.games,
      eq(schema.games.id, schema.communityLineups.decidedGameId),
    )
    .where(
      and(
        eq(schema.communityLineups.status, 'decided'),
        isNotNull(schema.communityLineups.decidedGameId),
      ),
    )
    .orderBy(desc(schema.communityLineups.updatedAt))
    .limit(WINNER_HISTORY_WINDOW);
  return rows.map((r) => ({
    gameId: r.gameId,
    name: r.name,
    tags: (r.tags as unknown as string[] | null) ?? [],
  }));
}
