/**
 * ROK-1873 (ROK-1428 L11 / M7, A1, A8/D8) — community-hub activity.
 *
 * - The `hub` signal: one activity item per `game_community` hub (A1: "one
 *   hub"), refreshed by its proposal (`created_at`), approval
 *   (`reviewed_at`), leader posts (ROK-1868) and member joins (ROK-1870).
 *   Proposed and active hubs count; archived or hidden hubs never do.
 * - The hub HOLD (D8): an `active`, visible community hub with hub activity
 *   in the window — approval, a leader post, a join or a tagged event —
 *   creates its game's channel (X2) and keeps it open (X6/X8, never X7).
 *   Dormant after the window; archiving or hiding the hub releases it at once.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { GameActivitySignal, SignalWindow } from './game-activity.signals';

type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

const DAY_MS = 86_400_000;

function ts(value: Date): SQL {
  return sql`${value.toISOString()}::timestamptz`;
}

/** Latest post / join on hub `h` (NULLs are ignored by GREATEST). */
const POST_AND_JOIN = sql`
  (SELECT max(p.created_at) FROM hub_posts p WHERE p.guild_id = h.id),
  (SELECT max(m.joined_at) FROM hub_community_members m WHERE m.guild_id = h.id)`;

/** A tagged, non-cancelled event (upcoming counts, clamped to `now`). */
function taggedEventAt(now: Date): SQL {
  return sql`(SELECT max(LEAST(lower(e.duration)::timestamptz, ${ts(now)}))
                FROM events e
               WHERE e.guild_id = h.id AND e.cancelled_at IS NULL)`;
}

/** The `hub` signal (D2: appended to the registry by L11). */
export const hubSignal: GameActivitySignal = {
  kind: 'hub',
  select: ({ windowStart }) => sql`
    SELECT h.game_id, h.id::text AS item_id, a.last_at
      FROM guilds h
     CROSS JOIN LATERAL (
       SELECT GREATEST(h.created_at, h.reviewed_at, ${POST_AND_JOIN})::timestamptz AS last_at
     ) a
     WHERE h.kind = 'game_community'
       AND h.status <> 'archived'
       AND h.hidden_at IS NULL
       AND a.last_at >= ${ts(windowStart)}`,
};

/** The window for a lifecycle tick (`recentActivityDays`). */
export function holdWindow(now: Date, windowDays: number): SignalWindow {
  return { now, windowStart: new Date(now.getTime() - windowDays * DAY_MS) };
}

/** The D8 hold predicate's SQL, exported for the unit spec. */
export function hubHoldSql({ now, windowStart }: SignalWindow): SQL {
  return sql`
    SELECT DISTINCT h.game_id
      FROM guilds h
     WHERE h.kind = 'game_community'
       AND h.status = 'active'
       AND h.hidden_at IS NULL
       AND GREATEST(h.created_at, h.reviewed_at, ${POST_AND_JOIN},
                    ${taggedEventAt(now)})::timestamptz >= ${ts(windowStart)}`;
}

/** Games an active, non-dormant community hub holds open (D8). */
export async function selectHubHoldGameIds(
  db: Db,
  window: SignalWindow,
): Promise<Set<number>> {
  const rows = await db.execute<{ game_id: number }>(hubHoldSql(window));
  return new Set(Array.from(rows, (r) => Number(r.game_id)));
}
