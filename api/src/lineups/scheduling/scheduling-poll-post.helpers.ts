/**
 * Reads the initial poll-card post needs (ROK-1473).
 *
 * Extracted from `SchedulingPollEmbedService` so the service stays inside the
 * 300-line cap while gaining the entered-scheduling listener.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** What the initial-post path needs to know about a match. */
export interface InitialPostMatch {
  id: number;
  lineupId: number;
  gameId: number;
  /** Non-null once a card exists — the idempotency signal. */
  embedMessageId: string | null;
  /** Per-lineup Discord channel override (ROK-1064), joined from the lineup. */
  channelOverrideId: string | null;
}

/**
 * Load a match plus its lineup's channel override.
 *
 * @param db - Drizzle handle.
 * @param matchId - Match that entered the scheduling phase.
 * @returns The row, or null when the match vanished (deleted, re-decided).
 */
export async function loadMatchForInitialPost(
  db: Db,
  matchId: number,
): Promise<InitialPostMatch | null> {
  const [row] = await db
    .select({
      id: schema.communityLineupMatches.id,
      lineupId: schema.communityLineupMatches.lineupId,
      gameId: schema.communityLineupMatches.gameId,
      embedMessageId: schema.communityLineupMatches.embedMessageId,
      channelOverrideId: schema.communityLineups.channelOverrideId,
    })
    .from(schema.communityLineupMatches)
    .leftJoin(
      schema.communityLineups,
      eq(schema.communityLineupMatches.lineupId, schema.communityLineups.id),
    )
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  return row
    ? { ...row, channelOverrideId: row.channelOverrideId ?? null }
    : null;
}

/**
 * Re-read the match immediately before posting (ROK-1473, D3).
 *
 * The hook's own guard reads the row before channel resolution awaits, so a
 * concurrent re-entry or retry could still slip a second card in. This is the
 * last check the poster makes.
 *
 * @param db - Drizzle handle.
 * @param matchId - Match about to receive a card.
 * @returns True when a card already exists and posting must be skipped.
 */
export async function hasPostedEmbed(
  db: Db,
  matchId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ embedMessageId: schema.communityLineupMatches.embedMessageId })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  return Boolean(row?.embedMessageId);
}
