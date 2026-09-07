/**
 * Lineup → LFG bridge helpers (ROK-1457).
 *
 * A closing lineup OFFERS LFG to the nominators of games that did not win.
 * Nothing in this file writes anywhere — the only reader is
 * `findBridgeCandidates`, and the grouping is pure. The intent row itself is
 * only ever written by the player's own `POST /lfg`.
 */
import { and, asc, eq, isNotNull, ne, notExists, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { VISIBILITY_FILTER } from '../igdb/igdb-visibility.helpers';
import { eligibleUser, liveIntent, type LfgDb } from './lfg-query.helpers';

/** One-shot cool-down per (user, game) — a later close re-offers after this. */
export const LFG_BRIDGE_DEDUP_TTL_DAYS = 30;

/** {@link LFG_BRIDGE_DEDUP_TTL_DAYS} in the unit `checkAndMarkSent` takes. */
export const LFG_BRIDGE_DEDUP_TTL_SECONDS =
  LFG_BRIDGE_DEDUP_TTL_DAYS * 24 * 60 * 60;

/** Games named in the notification body before "and N more". */
export const BRIDGE_GAMES_IN_BODY = 3;

/** Marker on the notification payload so readers can tell a bridge offer
 * from every other `community_lineup` notification. */
export const LFG_BRIDGE_PAYLOAD_KIND = 'lfg-bridge';

/** A losing nomination whose nominator holds no live intent on the game. */
export interface BridgeCandidate {
  userId: number;
  gameId: number;
  gameName: string;
  gameSlug: string;
  gameCoverUrl: string | null;
  lineupId: number;
  lineupTitle: string;
}

/** The notification a single user receives for one lineup close. */
export interface BridgeBatch {
  userId: number;
  gameIds: number[];
  title: string;
  message: string;
  payload: {
    kind: typeof LFG_BRIDGE_PAYLOAD_KIND;
    lineupId: number;
    lineupTitle: string;
    games: { gameId: number; gameName: string; gameSlug: string }[];
    link: string;
  };
}

/** Dedup key for the push — per (user, game), NOT per lineup (R2). */
export function bridgeDedupKey(userId: number, gameId: number): string {
  return `lfg-bridge:user:${userId}:game:${gameId}`;
}

/** A match row for this entry that cleared the threshold — "going somewhere". */
function thresholdMetMatch(db: LfgDb) {
  const m = schema.communityLineupMatches;
  const e = schema.communityLineupEntries;
  return db
    .select({ one: sql`1` })
    .from(m)
    .where(
      and(
        eq(m.lineupId, e.lineupId),
        eq(m.gameId, e.gameId),
        eq(m.thresholdMet, true),
      ),
    );
}

/** The nominator already holds a live intent on this game (AC5). Joins
 * `lfg_intents` AND `users`, as `liveIntent` requires. */
function nominatorLiveIntent(db: LfgDb, now: Date) {
  const li = schema.lfgIntents;
  const e = schema.communityLineupEntries;
  return db
    .select({ one: sql`1` })
    .from(li)
    .innerJoin(schema.users, eq(schema.users.id, li.userId))
    .where(
      and(eq(li.userId, e.nominatedBy), eq(li.gameId, e.gameId), liveIntent(now)),
    );
}

/**
 * Nominators of losing games with no live intent (D6) — one SQL read.
 *
 * "Losing" = not the winner AND no threshold-clearing match row, which keeps
 * zero-vote nominations in (R3). Eligibility of the nominator is
 * `eligibleUser()`, reused, never reimplemented.
 *
 * @param db - Drizzle handle.
 * @param lineupId - The lineup that just closed.
 * @param now - Instant "live" is measured against.
 * @param opts.userId - Restrict to one nominator (the page read, D9).
 */
export async function findBridgeCandidates(
  db: LfgDb,
  lineupId: number,
  now: Date,
  opts: { userId?: number } = {},
): Promise<BridgeCandidate[]> {
  const e = schema.communityLineupEntries;
  const l = schema.communityLineups;
  return db
    .select({
      userId: e.nominatedBy,
      gameId: schema.games.id,
      gameName: schema.games.name,
      gameSlug: schema.games.slug,
      gameCoverUrl: schema.games.coverUrl,
      lineupId: l.id,
      lineupTitle: l.title,
    })
    .from(e)
    .innerJoin(l, eq(l.id, e.lineupId))
    .innerJoin(schema.games, eq(schema.games.id, e.gameId))
    .innerJoin(schema.users, eq(schema.users.id, e.nominatedBy))
    .where(
      and(
        eq(e.lineupId, lineupId),
        isNotNull(l.decidedGameId),
        ne(e.gameId, l.decidedGameId),
        notExists(thresholdMetMatch(db)),
        eligibleUser(),
        notExists(nominatorLiveIntent(db, now)),
        VISIBILITY_FILTER(),
        opts.userId === undefined ? undefined : eq(e.nominatedBy, opts.userId),
      ),
    )
    .orderBy(asc(e.nominatedBy), asc(schema.games.name), asc(schema.games.id));
}

/** Body line naming up to `cap` games, then "and N more". */
function describeGames(names: string[], cap: number): string {
  const shown = names.slice(0, cap);
  const rest = names.length - shown.length;
  const list = shown.join(', ');
  return rest > 0 ? `${list} and ${rest} more` : list;
}

/**
 * Group candidates into ONE notification per user (AC6 / D7).
 *
 * Pure. `payload.games` carries every game; only the body is capped.
 *
 * @param rows - Candidates, any order.
 * @param cap - Games named in the body before "and N more".
 */
export function groupOffersByUser(
  rows: BridgeCandidate[],
  cap: number = BRIDGE_GAMES_IN_BODY,
): BridgeBatch[] {
  const byUser = new Map<number, BridgeCandidate[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  return [...byUser.entries()].map(([userId, games]) => {
    const { lineupId, lineupTitle } = games[0];
    const names = games.map((g) => g.gameName);
    return {
      userId,
      gameIds: games.map((g) => g.gameId),
      title: `${lineupTitle} — still want to play?`,
      message:
        `${describeGames(names, cap)} didn't make the cut. ` +
        `Say you're still up for it and others can join you.`,
      payload: {
        kind: LFG_BRIDGE_PAYLOAD_KIND,
        lineupId,
        lineupTitle,
        games: games.map((g) => ({
          gameId: g.gameId,
          gameName: g.gameName,
          gameSlug: g.gameSlug,
        })),
        link: `/lineups/${lineupId}`,
      },
    };
  });
}
