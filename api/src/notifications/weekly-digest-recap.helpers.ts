/**
 * Weekly Discord digest — section ② "last 7 days" recap aggregation (ROK-1435 slice L1).
 *
 * Guild-wide counts of events that finished in the last 7 days and the members
 * who attended them. The attendance predicate mirrors the `event_attendance`
 * CTE in `igdb/igdb-discover-community-playing.helpers.ts` (attended status,
 * linked user, not cancelled, event ended inside the window), and counts only
 * members still in the guild (not deactivated, banned or kicked).
 *
 * Privacy: whether a member's `show_activity = false` preference removes them
 * from the recap is operator Decision 4 in `planning-artifacts/specs/ROK-1435.md`,
 * still OPEN. The predicate therefore sits behind `respectActivityOptOut`,
 * defaulted to `true` (the spec's recommendation, and the same rule the
 * community-playing row already applies). Do not flip the default without the
 * ruling.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { ACTIVE_MEMBER_SQL_AND } from '../users/users-active.helpers';

export const RECAP_WINDOW_DAYS = 7;

export interface WeeklyRecapOptions {
  /** Drop members whose `show_activity` preference is `false`. Default `true`. */
  respectActivityOptOut?: boolean;
}

/**
 * Raw row from the recap query. Columns are cast `::int` in SQL, but typed
 * loosely because postgres-js returns un-cast bigint aggregates as text.
 */
export type WeeklyRecapRow = {
  events_run: number | string | null;
  players_attended: number | string | null;
  attendances: number | string | null;
};

export interface WeeklyRecap {
  /** Distinct events with at least one counted attendee. */
  eventsRun: number;
  /** Distinct members counted as attended. */
  playersAttended: number;
  /** Total (member, event) attendance pairs. */
  attendances: number;
}

const WINDOW = sql.raw(`INTERVAL '${RECAP_WINDOW_DAYS} days'`);

/**
 * `e.duration && tsrange(...)` lets the planner use `idx_events_duration_gist`;
 * it is a superset of the exact "ended inside the window" bounds kept below it.
 * Members who left the guild (deactivated), were banned or were kicked drop
 * out via `ACTIVE_MEMBER_SQL_AND` on the `users` join.
 */
const ATTENDED_CTE = sql`
  attended AS (
    SELECT s.user_id, e.id AS event_id
    FROM event_signups s
    INNER JOIN events e ON e.id = s.event_id
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.attendance_status = 'attended'
      AND s.user_id IS NOT NULL
      AND e.cancelled_at IS NULL
      AND e.duration && tsrange((NOW() - ${WINDOW})::timestamp, NOW()::timestamp, '[]')
      AND upper(e.duration) >= (NOW() - ${WINDOW})
      AND upper(e.duration) <= NOW()${sql.raw(ACTIVE_MEMBER_SQL_AND.trimEnd())}
  )`;

// Same predicate as the `filtered` CTE in igdb-discover-community-playing.helpers.ts.
const OPT_OUT_FILTERED_CTE = sql`
  filtered AS (
    SELECT a.* FROM attended a
    WHERE NOT EXISTS (
      SELECT 1 FROM user_preferences p
      WHERE p.user_id = a.user_id
        AND p.key = 'show_activity'
        AND p.value = 'false'::jsonb
    )
  )`;

const UNFILTERED_CTE = sql`
  filtered AS (
    SELECT a.* FROM attended a
  )`;

/** Build the recap query; the opt-out predicate is included only when asked. */
export function buildWeeklyRecapQuery(options: WeeklyRecapOptions = {}): SQL {
  const respect = options.respectActivityOptOut ?? true;
  const filtered = respect ? OPT_OUT_FILTERED_CTE : UNFILTERED_CTE;
  return sql`
    WITH ${ATTENDED_CTE},
    ${filtered}
    SELECT COUNT(DISTINCT event_id)::int AS events_run,
           COUNT(DISTINCT user_id)::int  AS players_attended,
           COUNT(*)::int                 AS attendances
    FROM filtered
  `;
}

/** Coerce one aggregate to a non-negative integer; junk and null become 0. */
function toCount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** Normalise the raw query row (or its absence) into a typed recap. */
export function shapeWeeklyRecap(row: WeeklyRecapRow | undefined): WeeklyRecap {
  return {
    eventsRun: toCount(row?.events_run),
    playersAttended: toCount(row?.players_attended),
    attendances: toCount(row?.attendances),
  };
}

/** True when nothing ran in the window — the digest can omit the section. */
export function isEmptyWeeklyRecap(recap: WeeklyRecap): boolean {
  return recap.eventsRun === 0;
}

/** Run the recap aggregation against the live database. */
export async function fetchWeeklyRecap(
  db: PostgresJsDatabase<typeof schema>,
  options: WeeklyRecapOptions = {},
): Promise<WeeklyRecap> {
  const rows = await db.execute<WeeklyRecapRow>(buildWeeklyRecapQuery(options));
  return shapeWeeklyRecap(Array.from(rows)[0]);
}
