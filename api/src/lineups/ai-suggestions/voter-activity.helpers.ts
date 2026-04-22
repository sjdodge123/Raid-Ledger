import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Top-N caps per signal — keeps the prompt compact. */
const RECENT_PLAY_LIMIT = 5;
const CO_PLAY_PARTNER_LIMIT = 3;
const EVENT_HISTORY_LIMIT = 3;
const EVENT_HISTORY_DAYS = 30;

/**
 * Raw behavioural signals per voter — what they ACTUALLY play and
 * who they play with, not the derived taste axes. Fed into the
 * curator prompt alongside `VoterProfile` so the LLM has concrete
 * behavioural context (what they've been grinding on Steam this
 * week, which other community members they frequently pair up with,
 * which games they've turned up for as a group).
 *
 * Usernames for co-play partners are included so the LLM can write
 * reasoning like "picks DRG because DragonSlayer99 and CasualCarl
 * already co-op 6 hours/week — extends an existing group pattern."
 */
export interface VoterActivity {
  userId: number;
  /** Top-5 games by Steam 2-week playtime, descending. */
  recentlyPlayed: { gameName: string; minutes2Weeks: number }[];
  /** Top-3 users this voter plays with the most, descending by hours. */
  coPlayPartners: { username: string; hoursTogether: number }[];
  /** Up-to-3 distinct games this voter signed up for in the last 30 days. */
  recentEventGames: string[];
}

interface PlaytimeRow {
  userId: number;
  gameName: string;
  minutes2Weeks: number;
}

async function loadRecentPlaytime(
  db: Db,
  userIds: number[],
): Promise<Map<number, PlaytimeRow[]>> {
  const rows = await db
    .select({
      userId: schema.gameInterests.userId,
      gameName: schema.games.name,
      minutes2Weeks: schema.gameInterests.playtime2weeks,
    })
    .from(schema.gameInterests)
    .innerJoin(schema.games, eq(schema.games.id, schema.gameInterests.gameId))
    .where(
      and(
        inArray(schema.gameInterests.userId, userIds),
        eq(schema.gameInterests.source, 'steam_library'),
        gt(schema.gameInterests.playtime2weeks, 0),
      ),
    )
    .orderBy(desc(schema.gameInterests.playtime2weeks));
  const byUser = new Map<number, PlaytimeRow[]>();
  for (const row of rows) {
    if (row.minutes2Weeks == null) continue;
    const bucket = byUser.get(row.userId) ?? [];
    if (bucket.length < RECENT_PLAY_LIMIT) {
      bucket.push({
        userId: row.userId,
        gameName: row.gameName,
        minutes2Weeks: row.minutes2Weeks,
      });
      byUser.set(row.userId, bucket);
    }
  }
  return byUser;
}

interface CoPlayRow {
  voterId: number;
  partnerId: number;
  totalMinutes: number;
}

async function loadCoPlayPartners(
  db: Db,
  userIds: number[],
): Promise<Map<number, { username: string; hoursTogether: number }[]>> {
  const voterSet = new Set(userIds);
  // `player_co_play` stores canonical ordering (userIdA < userIdB). We
  // pull every row where EITHER side is a voter, then normalise so
  // `voterId` is always the voter and `partnerId` is the other party.
  const pairs = await db
    .select({
      userIdA: schema.playerCoPlay.userIdA,
      userIdB: schema.playerCoPlay.userIdB,
      totalMinutes: schema.playerCoPlay.totalMinutes,
    })
    .from(schema.playerCoPlay)
    .where(
      or(
        inArray(schema.playerCoPlay.userIdA, userIds),
        inArray(schema.playerCoPlay.userIdB, userIds),
      ),
    )
    .orderBy(desc(schema.playerCoPlay.totalMinutes));
  const normalised: CoPlayRow[] = [];
  for (const row of pairs) {
    if (voterSet.has(row.userIdA)) {
      normalised.push({
        voterId: row.userIdA,
        partnerId: row.userIdB,
        totalMinutes: row.totalMinutes,
      });
    }
    if (voterSet.has(row.userIdB)) {
      normalised.push({
        voterId: row.userIdB,
        partnerId: row.userIdA,
        totalMinutes: row.totalMinutes,
      });
    }
  }
  const partnerIds = Array.from(new Set(normalised.map((r) => r.partnerId)));
  const partnerUsernames = new Map<number, string>();
  if (partnerIds.length > 0) {
    const usernames = await db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.id, partnerIds));
    for (const u of usernames) partnerUsernames.set(u.id, u.username);
  }
  const byVoter = new Map<
    number,
    { username: string; hoursTogether: number }[]
  >();
  for (const row of normalised) {
    const bucket = byVoter.get(row.voterId) ?? [];
    if (bucket.length >= CO_PLAY_PARTNER_LIMIT) continue;
    bucket.push({
      username: partnerUsernames.get(row.partnerId) ?? `user#${row.partnerId}`,
      hoursTogether: Math.round((row.totalMinutes / 60) * 10) / 10,
    });
    byVoter.set(row.voterId, bucket);
  }
  return byVoter;
}

async function loadRecentEventGames(
  db: Db,
  userIds: number[],
): Promise<Map<number, string[]>> {
  // Event has `duration: tstzrange` so "start" = lower(duration). Grab
  // distinct games the voter signed up for within the last 30 days.
  const rows = await db.execute<{ user_id: number; game_name: string }>(sql`
    SELECT DISTINCT ON (es.user_id, g.id)
      es.user_id AS user_id,
      g.name AS game_name,
      lower(e.duration) AS started_at
    FROM event_signups es
    JOIN events e ON e.id = es.event_id
    JOIN games g ON g.id = e.game_id
    WHERE es.user_id IN (${sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND lower(e.duration) > now() - interval '${sql.raw(String(EVENT_HISTORY_DAYS))} days'
      AND es.status IN ('signed_up', 'confirmed')
      AND e.cancelled_at IS NULL
    ORDER BY es.user_id, g.id, lower(e.duration) DESC
  `);
  const byUser = new Map<number, string[]>();
  for (const row of rows) {
    const bucket = byUser.get(row.user_id) ?? [];
    if (bucket.length < EVENT_HISTORY_LIMIT && !bucket.includes(row.game_name)) {
      bucket.push(row.game_name);
      byUser.set(row.user_id, bucket);
    }
  }
  return byUser;
}

/**
 * Bundle the three raw-signal queries into one call. Returns a map
 * keyed by voter ID; voters with no data in any signal still get an
 * entry with empty arrays (easier for the merger upstream).
 */
export async function loadVoterActivity(
  db: Db,
  userIds: number[],
): Promise<Map<number, VoterActivity>> {
  if (userIds.length === 0) return new Map();
  const [playMap, coPlayMap, eventMap] = await Promise.all([
    loadRecentPlaytime(db, userIds),
    loadCoPlayPartners(db, userIds),
    loadRecentEventGames(db, userIds),
  ]);
  const byUser = new Map<number, VoterActivity>();
  for (const userId of userIds) {
    byUser.set(userId, {
      userId,
      recentlyPlayed:
        playMap
          .get(userId)
          ?.map((r) => ({
            gameName: r.gameName,
            minutes2Weeks: r.minutes2Weeks,
          })) ?? [],
      coPlayPartners: coPlayMap.get(userId) ?? [],
      recentEventGames: eventMap.get(userId) ?? [],
    });
  }
  return byUser;
}
