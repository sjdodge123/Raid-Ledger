/**
 * ROK-1471 — the reads the LFG forum board makes against `lfg_group_messages`.
 *
 * Deliberately NOT added to 1454's `lfm-embed.db-helpers.ts`: that module is
 * the LFM embed consumer's data-access surface and its unit spec replaces the
 * whole module with a mock, so a board read added there would be mocked away in
 * every 1454 test rather than exercised by them.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { LfgDb } from '../../lfg/lfg-query.helpers';

/** The Discord coordinates of a message, as an interaction reports them. */
export interface LfmMessageLocator {
  guildId: string;
  channelId: string;
  messageId: string;
}

/** One tracked LFM/board message row. */
export type LfgBoardMessageRow = typeof schema.lfgGroupMessages.$inferSelect;

/**
 * The group row a Discord message belongs to, or null.
 *
 * Filters on the three columns of `idx_lfg_group_messages_message`, in that
 * index's own order, so the reverse lookup the `+1` button needs is an index
 * hit rather than a scan of every message the board ever posted.
 *
 * @param db - Drizzle handle.
 * @param locator - Guild, channel and message id of the clicked message.
 * @returns The row, or null when the message tracks no group.
 */
export async function findLfmMessageByIds(
  db: LfgDb,
  locator: LfmMessageLocator,
): Promise<LfgBoardMessageRow | null> {
  const [row] = await db
    .select()
    .from(schema.lfgGroupMessages)
    .where(
      and(
        eq(schema.lfgGroupMessages.guildId, locator.guildId),
        eq(schema.lfgGroupMessages.channelId, locator.channelId),
        eq(schema.lfgGroupMessages.messageId, locator.messageId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** A game's live forum post, as `/lfg` links to it (D8). */
export interface LfgBoardThread {
  gameId: number;
  guildId: string;
  threadId: string;
}

/**
 * Live forum threads for the given games — `open` rows carrying a `thread_id`.
 *
 * One query for a whole `/lfg list` reply: a per-row lookup would issue up to
 * 25 round trips to decorate one ephemeral message.
 *
 * @param db - Drizzle handle.
 * @param gameIds - Games the reply renders. An empty list reads nothing.
 * @returns One entry per game that currently has a forum post.
 */
export async function listLfmThreadsForGames(
  db: LfgDb,
  gameIds: number[],
): Promise<LfgBoardThread[]> {
  if (gameIds.length === 0) return [];
  const rows = await db
    .select({
      gameId: schema.lfgGroupMessages.gameId,
      guildId: schema.lfgGroupMessages.guildId,
      threadId: schema.lfgGroupMessages.threadId,
    })
    .from(schema.lfgGroupMessages)
    .where(
      and(
        inArray(schema.lfgGroupMessages.gameId, gameIds),
        eq(schema.lfgGroupMessages.state, 'open'),
        isNotNull(schema.lfgGroupMessages.threadId),
      ),
    );
  return rows.filter((row): row is LfgBoardThread => row.threadId !== null);
}
