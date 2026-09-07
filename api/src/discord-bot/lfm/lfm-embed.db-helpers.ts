/**
 * ROK-1454 D8/D9 — every read and write the LFM embed consumer makes.
 *
 * Split out of `LfmEmbedService` for one reason: the service's whole job is
 * *choosing* which read a lifecycle transition deserves (D6 says the three
 * terminal reasons deliberately use three different strategies), and that
 * choice is only testable if the data access behind it can be replaced. So
 * this file is the single data-access surface — the unit spec mocks this
 * module and nothing else, and it is this file the integration spec exercises
 * against real Postgres.
 *
 * NOTHING here reinterprets a read. `readLiveGroup` calls `getGroupSummary` +
 * `listGroupMembers` unchanged, and `readConvertedGroup` calls
 * `listConvertedGroupMembers` unchanged — the converted path must never
 * compose the live predicate family (that is the defect round 1 shipped).
 */
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type { LfgMemberDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  getGroupSummary,
  listGroupMembers,
  liveIntent,
  type LfgDb,
} from '../../lfg/lfg-query.helpers';
import { listConvertedGroupMembers } from '../../lfg/lfg-provenance.helpers';
import type { LfgConversionTarget } from '../../lfg/lfg-write.helpers';
import type { LfgPostKind } from '../lfg-board/lfg-board.constants';
import type { LfmTarget } from './lfm-embed.helpers';

/** One tracked LFM message. */
/** An LFG group is LFM — and owns a channel message — from two live hands. */
export const LFM_FLOOR = 2;

export type LfmMessageRow = typeof schema.lfgGroupMessages.$inferSelect;

/** The games row the render projects from — badge columns included. */
export type LfmGameRow = typeof schema.games.$inferSelect;

/** The states a row can be CLOSED into. `open` is not one of them. */
export type LfmTerminalState = 'converted' | 'expired' | 'closed';

/** What a fresh post records. */
export interface LfmMessageInsert {
  gameId: number;
  guildId: string;
  channelId: string;
  messageId: string;
  lastMemberCount: number;
  /**
   * ROK-1471: the forum thread the post lives in. On a forum row `channelId`
   * is the SAME id — a button interaction inside a forum post carries the
   * thread as its `channelId`, and `findLfmMessageByIds` matches on that.
   */
  threadId?: string | null;
  /** ROK-1471: which surface the row was posted to. Column defaults to text. */
  postKind?: LfgPostKind;
}

/** The live group as an open-state render reads it. */
export interface LfmLiveGroup {
  members: LfgMemberDto[];
  soonestExpiresAt: string | null;
  viabilityThreshold: number | null;
}

/**
 * `hasOwnIntent` is meaningless for a channel render — there is no viewer, and
 * `bool_or(user_id = 0)` is simply false. Named so the 0 is not read as a bug.
 */
const NO_VIEWER = 0;

/**
 * The live message for a game, or null.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group is being rendered.
 * @returns The `open` row, or null when the game has no live message.
 */
export async function findOpenLfmMessage(
  db: LfgDb,
  gameId: number,
): Promise<LfmMessageRow | null> {
  const [row] = await db
    .select()
    .from(schema.lfgGroupMessages)
    .where(
      and(
        eq(schema.lfgGroupMessages.gameId, gameId),
        eq(schema.lfgGroupMessages.state, 'open'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Every `open` row, oldest first — the restart-reconcile worklist (D9).
 *
 * @param db - Drizzle handle.
 * @returns All rows still believed to be live.
 */
export async function listOpenLfmMessages(db: LfgDb): Promise<LfmMessageRow[]> {
  return db
    .select()
    .from(schema.lfgGroupMessages)
    .where(eq(schema.lfgGroupMessages.state, 'open'))
    .orderBy(schema.lfgGroupMessages.postedAt);
}

/**
 * Record a freshly posted message.
 *
 * Deliberately NOT `onConflictDoNothing`: the partial unique index
 * `uq_lfg_group_messages_game_open` is the "one live message per group"
 * invariant, and a second open insert for the same game is a bug the caller
 * needs to hear about, not a row to silently drop.
 *
 * @param db - Drizzle handle.
 * @param input - Where the message landed and how many were in it.
 */
export async function insertLfmMessage(
  db: LfgDb,
  input: LfmMessageInsert,
): Promise<void> {
  await db.insert(schema.lfgGroupMessages).values({ ...input, state: 'open' });
}

/** Stamp a successful in-place edit that left the group open. */
export async function recordLfmRender(
  db: LfgDb,
  id: string,
  memberCount: number,
): Promise<void> {
  await db
    .update(schema.lfgGroupMessages)
    .set({ lastMemberCount: memberCount, updatedAt: new Date() })
    .where(eq(schema.lfgGroupMessages.id, id));
}

/**
 * Close a row into a terminal state.
 *
 * Clearing `open` is what releases the partial unique index so the game's NEXT
 * group can post at all — without it the index wedges that game forever (D9).
 *
 * @param db - Drizzle handle.
 * @param id - Row to close.
 * @param state - The terminal state reached.
 * @param memberCount - Head-count rendered in the final edit.
 */
export async function closeLfmMessage(
  db: LfgDb,
  id: string,
  state: LfmTerminalState,
  memberCount: number,
): Promise<void> {
  const now = new Date();
  await db
    .update(schema.lfgGroupMessages)
    .set({ state, lastMemberCount: memberCount, updatedAt: now, closedAt: now })
    .where(eq(schema.lfgGroupMessages.id, id));
}

/** Drop a row whose Discord message a human deleted (E3, still-open case). */
export async function deleteLfmMessage(db: LfgDb, id: string): Promise<void> {
  await db
    .delete(schema.lfgGroupMessages)
    .where(eq(schema.lfgGroupMessages.id, id));
}

/**
 * The games row, badge columns and all.
 *
 * The whole row rather than a projection: `getGroupSummary` takes a full row,
 * and `GameBadgeInputs` reads ten more columns off the same fetch.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game to load.
 * @returns The row, or null when the game was deleted mid-flight (E13).
 */
export async function loadLfmGame(
  db: LfgDb,
  gameId: number,
): Promise<LfmGameRow | null> {
  const [row] = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return row ?? null;
}

/**
 * The live group (D8): `getGroupSummary` + `listGroupMembers`, both unchanged.
 *
 * @param db - Drizzle handle.
 * @param game - The already-loaded games row.
 * @returns Members in join order plus the two aggregate facts the chrome needs.
 */
export async function readLiveGroup(
  db: LfgDb,
  game: LfmGameRow,
): Promise<LfmLiveGroup> {
  const [summary, members] = await Promise.all([
    getGroupSummary(db, game, NO_VIEWER),
    listGroupMembers(db, game.id),
  ]);
  return {
    members,
    soonestExpiresAt: summary.soonestExpiresAt,
    viabilityThreshold: summary.viabilityThreshold,
  };
}

/**
 * The converted group's roster (D5) — by provenance, never by `liveIntent`.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose converted group to read.
 * @param target - The conversion target carried on the transition payload.
 * @returns The eligible members that converted into `target`.
 */
export async function readConvertedGroup(
  db: LfgDb,
  gameId: number,
  target: LfgConversionTarget,
): Promise<LfgMemberDto[]> {
  return listConvertedGroupMembers(db, gameId, target);
}

/**
 * Newest conversion provenance for a game, or null (D9).
 *
 * Used only by the restart reconcile, where the transition payload is long
 * gone and the row itself is the only surviving evidence of what happened.
 * Newest first, because an older group for the same game converted months ago.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose open row is being reconciled.
 * @returns The most recent conversion target, or null when none exists.
 * @param postedAfter - When the message being reconciled was posted; only
 *   provenance whose hands expire after that can belong to its group.
 */
export async function latestConversionTarget(
  db: LfgDb,
  gameId: number,
  postedAfter: Date,
): Promise<LfgConversionTarget | null> {
  const [row] = await db
    .select({
      pollId: schema.lfgIntents.convertedToPollId,
      eventId: schema.lfgIntents.convertedToEventId,
    })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'converted'),
        // The row's group was live when its message was posted, and conversion
        // never resets the clock, so ITS hands still expire after `postedAfter`.
        // A corpse from an older group of the same game does not, and must not
        // be mistaken for this group's conversion (E6 at reconcile time).
        gt(schema.lfgIntents.expiresAt, postedAfter),
        or(
          isNotNull(schema.lfgIntents.convertedToPollId),
          isNotNull(schema.lfgIntents.convertedToEventId),
        ),
      ),
    )
    .orderBy(desc(schema.lfgIntents.id))
    .limit(1);
  if (!row) return null;
  if (row.pollId !== null) return { pollId: row.pollId };
  return { eventId: row.eventId as number };
}

/**
 * Resolve the SCHEDULED poll link.
 *
 * `ConvertLfgIntentsDto.pollId` is documented as `community_lineup_matches.id`
 * (`packages/contract/src/lfg.schema.ts`), so it is ALREADY the match id — the
 * only missing half is the lineup it belongs to. The route's final segment is a
 * MATCH id (`web/src/app-routes.tsx`); putting a poll id there yields a dead
 * link no type-check can see.
 *
 * @param db - Drizzle handle.
 * @param matchId - `community_lineup_matches.id`, as conversion recorded it.
 * @returns The poll link target, or null when the match row is gone.
 */
export async function resolvePollTarget(
  db: LfgDb,
  matchId: number,
): Promise<LfmTarget | null> {
  const [row] = await db
    .select({ lineupId: schema.communityLineupMatches.lineupId })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  if (!row) return null;
  return { kind: 'poll', lineupId: row.lineupId, matchId };
}

/**
 * Games with a live LFM group and NO `open` message — the group crossed the
 * floor while the bot was disconnected (E1), so `LFM_REACHED` was dropped and
 * no row was ever written. `reconcileOpenRows` cannot see these: there is no
 * row to walk. Same live predicate as the roster read (`liveIntent`, which
 * composes eligibility), so a banned or deactivated hand does not count.
 *
 * @param db - Drizzle handle.
 * @param now - Clock, injectable for tests.
 * @returns Distinct game ids that deserve the first post they never got.
 */
export async function listUntrackedLfmGames(
  db: LfgDb,
  now: Date = new Date(),
): Promise<number[]> {
  const openRowForGame = db
    .select({ one: sql`1` })
    .from(schema.lfgGroupMessages)
    .where(
      and(
        eq(schema.lfgGroupMessages.gameId, schema.lfgIntents.gameId),
        eq(schema.lfgGroupMessages.state, 'open'),
      ),
    );
  const rows = await db
    .select({ gameId: schema.lfgIntents.gameId })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(and(liveIntent(now), notExists(openRowForGame)))
    .groupBy(schema.lfgIntents.gameId)
    .having(gte(count(), LFM_FLOOR));
  return rows.map((r) => r.gameId);
}
