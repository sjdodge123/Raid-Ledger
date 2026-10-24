import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { AttendanceTrendsPeriod } from '@raid-ledger/contract';

type TrendRow = Record<string, unknown> & {
  event_date: string;
  attended: string;
  no_show: string;
  excused: string;
  total: string;
  distinct_events: string;
};

export async function queryAttendanceTrends(
  db: PostgresJsDatabase<typeof schema>,
  cutoff: Date,
): Promise<TrendRow[]> {
  return db.execute<TrendRow>(sql`
    SELECT
      DATE(upper(e.duration)) AS event_date,
      COUNT(*) FILTER (WHERE es.attendance_status = 'attended') AS attended,
      COUNT(*) FILTER (WHERE es.attendance_status = 'no_show') AS no_show,
      COUNT(*) FILTER (WHERE es.attendance_status = 'excused') AS excused,
      COUNT(*) AS total,
      COUNT(DISTINCT e.id) AS distinct_events
    FROM events e
    JOIN event_signups es ON es.event_id = e.id
    WHERE upper(e.duration) >= ${cutoff.toISOString()}::timestamptz
      AND upper(e.duration) <= NOW()
      AND e.cancelled_at IS NULL
      AND es.attendance_status IS NOT NULL
    GROUP BY DATE(upper(e.duration))
    ORDER BY event_date ASC
  `);
}

function mapTrendDataPoints(rows: TrendRow[]) {
  return rows.map((r) => ({
    date: r.event_date,
    attended: Number(r.attended),
    noShow: Number(r.no_show),
    excused: Number(r.excused),
    total: Number(r.total),
  }));
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 100) / 100
    : 0;
}

export function buildTrendsSummary(
  rows: TrendRow[],
  period: AttendanceTrendsPeriod,
) {
  const dataPoints = mapTrendDataPoints(rows);
  const totalAttended = dataPoints.reduce((s, d) => s + d.attended, 0);
  const totalNoShow = dataPoints.reduce((s, d) => s + d.noShow, 0);
  const totalMarked = dataPoints.reduce((s, d) => s + d.total, 0);
  const totalEvents = rows.reduce((s, r) => s + Number(r.distinct_events), 0);
  return {
    period,
    dataPoints,
    summary: {
      avgAttendanceRate: safeRate(totalAttended, totalMarked),
      avgNoShowRate: safeRate(totalNoShow, totalMarked),
      totalEvents,
    },
  };
}

type ReliabilityRow = Record<string, unknown> & {
  user_id: string;
  username: string;
  avatar: string | null;
  total_events: string;
  attended: string;
  no_show: string;
  excused: string;
  late: string;
};

/**
 * ROK-1938: at most one `late` voice row per signup. LATERAL + LIMIT 1 so a
 * signup matched by both discord id and user id never multiplies COUNT(*).
 * Literal aliases only — no column interpolation (correlated refs bind wrong).
 * The outer attended check lets non-attended signups skip the index lookup;
 * LATE_COUNT still filters on it, so results are unchanged.
 */
const LATE_VOICE_JOIN = sql`
  LEFT JOIN LATERAL (
    SELECT 1 AS hit
    FROM event_voice_sessions v
    WHERE es.attendance_status = 'attended'
      AND v.event_id = es.event_id
      AND v.classification = 'late'
      AND (v.discord_user_id = es.discord_user_id OR v.user_id = es.user_id)
    LIMIT 1
  ) lv ON TRUE
`;

/** Late ⊂ attended: an organiser's manual no_show/excused mark beats the voice label. */
const LATE_COUNT = sql`COUNT(*) FILTER (WHERE es.attendance_status = 'attended' AND lv.hit IS NOT NULL)`;

export async function queryUserReliability(
  db: PostgresJsDatabase<typeof schema>,
  limit: number,
  offset: number,
): Promise<{ rows: ReliabilityRow[]; totalUsers: number }> {
  const rows = await queryReliabilityRows(db, limit, offset);
  const totalUsers = await queryReliabilityCount(db);
  return { rows, totalUsers };
}

async function queryReliabilityRows(
  db: PostgresJsDatabase<typeof schema>,
  limit: number,
  offset: number,
): Promise<ReliabilityRow[]> {
  return db.execute<ReliabilityRow>(sql`
    SELECT
      u.id AS user_id, u.username, u.avatar,
      COUNT(*) AS total_events,
      COUNT(*) FILTER (WHERE es.attendance_status = 'attended') AS attended,
      COUNT(*) FILTER (WHERE es.attendance_status = 'no_show') AS no_show,
      COUNT(*) FILTER (WHERE es.attendance_status = 'excused') AS excused,
      ${LATE_COUNT} AS late
    FROM event_signups es
    JOIN users u ON es.user_id = u.id
    JOIN events e ON es.event_id = e.id
    ${LATE_VOICE_JOIN}
    WHERE es.attendance_status IS NOT NULL
      AND e.cancelled_at IS NULL AND upper(e.duration) <= NOW()
    GROUP BY u.id, u.username, u.avatar
    ORDER BY COUNT(*) DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
}

async function queryReliabilityCount(
  db: PostgresJsDatabase<typeof schema>,
): Promise<number> {
  const [countRow] = await db.execute<
    Record<string, unknown> & { count: string }
  >(sql`
    SELECT COUNT(DISTINCT es.user_id) AS count
    FROM event_signups es
    JOIN events e ON es.event_id = e.id
    WHERE es.attendance_status IS NOT NULL
      AND e.cancelled_at IS NULL AND upper(e.duration) <= NOW()
      AND es.user_id IS NOT NULL
  `);
  return Number(countRow?.count ?? 0);
}

export function mapReliabilityUsers(rows: ReliabilityRow[]) {
  return rows.map((r) => {
    const total = Number(r.total_events);
    const attended = Number(r.attended);
    return {
      userId: Number(r.user_id),
      username: r.username,
      avatar: r.avatar,
      totalEvents: total,
      attended,
      noShow: Number(r.no_show),
      excused: Number(r.excused),
      lateCount: Number(r.late),
      attendanceRate:
        total > 0 ? Math.round((attended / total) * 100) / 100 : 0,
    };
  });
}

export async function queryGameAttendance(
  db: PostgresJsDatabase<typeof schema>,
) {
  const rows = await queryGameAttendanceRows(db);
  return { games: mapGameRows(rows) };
}

async function queryGameAttendanceRows(db: PostgresJsDatabase<typeof schema>) {
  return db.execute<Record<string, unknown> & GameRow>(sql`
    SELECT
      g.id AS game_id, g.name AS game_name, g.cover_url,
      COUNT(DISTINCT e.id) AS total_events,
      COUNT(*) AS total_signups,
      COUNT(*) FILTER (WHERE es.attendance_status = 'attended') AS attended,
      COUNT(*) FILTER (WHERE es.attendance_status = 'no_show') AS no_show,
      ${LATE_COUNT} AS late
    FROM events e
    JOIN games g ON e.game_id = g.id
    JOIN event_signups es ON es.event_id = e.id
    ${LATE_VOICE_JOIN}
    WHERE upper(e.duration) <= NOW()
      AND e.cancelled_at IS NULL AND es.attendance_status IS NOT NULL
    GROUP BY g.id, g.name, g.cover_url
    ORDER BY COUNT(DISTINCT e.id) DESC
  `);
}

type GameRow = {
  game_id: string;
  game_name: string;
  cover_url: string | null;
  total_events: string;
  total_signups: string;
  attended: string;
  no_show: string;
  late: string;
};

function mapGameRows(rows: GameRow[]) {
  return rows.map((r) => {
    const totalSignups = Number(r.total_signups);
    return {
      gameId: Number(r.game_id),
      gameName: r.game_name,
      coverUrl: r.cover_url,
      totalEvents: Number(r.total_events),
      avgAttendanceRate: safeRate(Number(r.attended), totalSignups),
      avgNoShowRate: safeRate(Number(r.no_show), totalSignups),
      avgLateRate: safeRate(Number(r.late), totalSignups),
      totalSignups,
    };
  });
}
