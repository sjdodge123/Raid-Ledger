/**
 * Reads the initial poll-card post needs (ROK-1473).
 *
 * Extracted from `SchedulingPollEmbedService` so the service stays inside the
 * 300-line cap while gaining the entered-scheduling listener.
 */
import { and, eq, isNull } from 'drizzle-orm';
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
 * Claim the poll-card slot on a match (ROK-1473 review follow-up).
 *
 * A read-then-write guard loses the race two concurrent hook deliveries can
 * create, so the poster CLAIMS the slot with one conditional UPDATE and only
 * sends when the row comes back. The predicate also swallows the stale-event
 * cases for free: a re-decide deleted the match (no row), a lock-in/archive
 * moved it out of `scheduling`, or another poster already claimed it.
 *
 * @param db - Drizzle handle.
 * @param matchId - Match about to receive a card.
 * @param channelId - Channel the claiming poster will send to.
 * @returns True when THIS caller won the claim and must send the card.
 */
export async function claimEmbedSlot(
  db: Db,
  matchId: number,
  channelId: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.communityLineupMatches)
    .set({ embedChannelId: channelId })
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        eq(schema.communityLineupMatches.status, 'scheduling'),
        isNull(schema.communityLineupMatches.embedMessageId),
        isNull(schema.communityLineupMatches.embedChannelId),
      ),
    )
    .returning({ id: schema.communityLineupMatches.id });
  return rows.length > 0;
}

/**
 * Drop a claim whose send never landed, so a later retry can post.
 *
 * Guarded on `embed_message_id IS NULL` — a claim that DID produce a message
 * must never have its channel cleared out from under the stored reference.
 *
 * @param db - Drizzle handle.
 * @param matchId - Match whose claim should be released.
 */
export async function releaseEmbedClaim(
  db: Db,
  matchId: number,
): Promise<void> {
  await db
    .update(schema.communityLineupMatches)
    .set({ embedChannelId: null })
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        isNull(schema.communityLineupMatches.embedMessageId),
      ),
    );
}
