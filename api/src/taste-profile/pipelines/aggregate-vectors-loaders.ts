import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { GameMetadata } from '../taste-vector.helpers';
import type { SignalSummary } from '../signal-hash.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Load all games with their IGDB metadata + lowercased ITAD tags. */
export async function loadGameMetadata(
  db: Db,
): Promise<Map<number, GameMetadata>> {
  const rows = await db
    .select({
      id: schema.games.id,
      genres: schema.games.genres,
      gameModes: schema.games.gameModes,
      themes: schema.games.themes,
      itadTags: schema.games.itadTags,
    })
    .from(schema.games);
  const map = new Map<number, GameMetadata>();
  for (const r of rows) {
    const rawTags = Array.isArray(r.itadTags) ? r.itadTags : [];
    map.set(r.id, {
      gameId: r.id,
      genres: r.genres ?? [],
      gameModes: r.gameModes ?? [],
      themes: r.themes ?? [],
      tags: rawTags.map((t) => t.toLowerCase()),
    });
  }
  return map;
}

/** Per-user co-play partner counts — one query, grouped. */
export async function loadCoPlayCounts(db: Db): Promise<Map<number, number>> {
  const rows = await db.execute<{ user_id: number; c: number }>(sql`
    SELECT user_id, COUNT(*)::int AS c FROM (
      SELECT user_id_a AS user_id FROM player_co_play
      UNION ALL
      SELECT user_id_b AS user_id FROM player_co_play
    ) t GROUP BY user_id
  `);
  const map = new Map<number, number>();
  for (const r of rows as unknown as Array<{ user_id: number; c: number }>) {
    map.set(r.user_id, Number(r.c));
  }
  return map;
}

type UserCountRow = {
  user_id: number;
  count: string;
  max_updated: Date | null;
};
type UserPeriodRow = {
  user_id: number;
  count: string;
  max_period: string | null;
};

function freshSummary(): SignalSummary {
  return {
    gameInterests: { count: 0, maxUpdatedAt: null },
    gameActivityRollups: { count: 0, maxPeriodStart: null },
    eventSignups: { count: 0, maxUpdatedAt: null },
    eventVoiceSessions: { count: 0, maxLastLeaveAt: null },
  };
}

/** Per-user summary inputs for `computeSignalHash`. */
export async function loadSignalHashComponents(
  db: Db,
): Promise<Map<number, SignalSummary>> {
  const interests = (await db.execute(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(created_at) AS max_updated
    FROM ${schema.gameInterests} GROUP BY user_id
  `)) as unknown as UserCountRow[];
  const rollups = (await db.execute(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(period_start::text) AS max_period
    FROM ${schema.gameActivityRollups} GROUP BY user_id
  `)) as unknown as UserPeriodRow[];
  const signups = (await db.execute(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(signed_up_at) AS max_updated
    FROM ${schema.eventSignups} GROUP BY user_id
  `)) as unknown as UserCountRow[];
  const voice = (await db.execute(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(last_leave_at) AS max_updated
    FROM ${schema.eventVoiceSessions} GROUP BY user_id
  `)) as unknown as UserCountRow[];

  const summaries = new Map<number, SignalSummary>();
  const ensure = (id: number): SignalSummary => {
    const existing = summaries.get(id);
    if (existing) return existing;
    const s = freshSummary();
    summaries.set(id, s);
    return s;
  };

  for (const r of interests) {
    ensure(r.user_id).gameInterests = {
      count: Number(r.count),
      maxUpdatedAt: r.max_updated,
    };
  }
  for (const r of rollups) {
    ensure(r.user_id).gameActivityRollups = {
      count: Number(r.count),
      maxPeriodStart: r.max_period,
    };
  }
  for (const r of signups) {
    ensure(r.user_id).eventSignups = {
      count: Number(r.count),
      maxUpdatedAt: r.max_updated,
    };
  }
  for (const r of voice) {
    ensure(r.user_id).eventVoiceSessions = {
      count: Number(r.count),
      maxLastLeaveAt: r.max_updated,
    };
  }

  return summaries;
}

export function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function groupMap<T, K, V>(
  rows: T[],
  key: (row: T) => K,
  value: (row: T) => V,
): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const row of rows) {
    const k = key(row);
    const v = value(row);
    const list = map.get(k);
    if (list) list.push(v);
    else map.set(k, [v]);
  }
  return map;
}
