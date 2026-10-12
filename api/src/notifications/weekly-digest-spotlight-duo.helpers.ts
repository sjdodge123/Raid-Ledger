/**
 * ROK-1771 L3 — A2 "Duo of the week" (spec §2 table A). `player_co_play` is
 * all-time with no week slice (NOT VIABLE), so this feeds only this week's
 * `event_voice_sessions` through the existing co-play math
 * (`aggregateCoPlay` / `voiceOverlapMinutes`) — reused, not copied.
 *
 * Privacy: sessions of opted-out (`show_activity = false`) or inactive
 * members are dropped before pairing, so a pair with either member opted out
 * never forms — the pair is dropped, not just a name hidden.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { ACTIVE_MEMBER_SQL_AND } from '../users/users-active.helpers';
import {
  aggregateCoPlay,
  voiceOverlapMinutes,
  type CoPlayAggregate,
  type VoiceSessionRow,
} from '../taste-profile/co-play-graph.helpers';
import { SHOWS_ACTIVITY_SQL } from './weekly-digest-recap.helpers';
import type {
  DuoCandidate,
  SpotlightMember,
} from './weekly-digest-spotlight.helpers';

/** One voice session of this week, with the names the candidate needs. */
export type DuoSessionRow = {
  event_id: number;
  event_title: string;
  game_id: number | null;
  user_id: number;
  user_name: string;
  segments: VoiceSessionRow['segments'];
};

/** This week's voice sessions of active, not-opted-out linked members. */
export function buildDuoSessionsQuery(): SQL {
  return sql`
    SELECT s.event_id, e.title AS event_title, e.game_id, s.user_id,
           COALESCE(u.display_name, u.username) AS user_name, s.segments
    FROM event_voice_sessions s
    INNER JOIN events e ON e.id = s.event_id
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.user_id IS NOT NULL
      AND e.cancelled_at IS NULL
      AND s.first_join_at >= NOW() - INTERVAL '7 days'
      AND s.first_join_at < NOW()${sql.raw(ACTIVE_MEMBER_SQL_AND.trimEnd())}
      AND ${SHOWS_ACTIVITY_SQL('s.user_id')}
    ORDER BY s.event_id, s.user_id
  `;
}

function toSession(r: DuoSessionRow): VoiceSessionRow {
  return {
    eventId: r.event_id,
    userId: r.user_id,
    gameId: r.game_id,
    segments: r.segments,
  };
}

/** Group rows into `aggregateCoPlay`'s input shape. */
export function groupSessionsByEvent(
  rows: readonly DuoSessionRow[],
): Map<number, VoiceSessionRow[]> {
  const byEvent = new Map<number, VoiceSessionRow[]>();
  for (const r of rows) {
    const list = byEvent.get(r.event_id) ?? [];
    list.push(toSession(r));
    byEvent.set(r.event_id, list);
  }
  return byEvent;
}

/** Most minutes together; ties → lower user ids (deterministic). */
export function topPair(
  aggregates: readonly CoPlayAggregate[],
): CoPlayAggregate | null {
  const sorted = [...aggregates].sort(
    (a, b) =>
      b.totalMinutes - a.totalMinutes ||
      a.userIdA - b.userIdA ||
      a.userIdB - b.userIdB,
  );
  return sorted[0] ?? null;
}

function sessionOf(
  rows: readonly DuoSessionRow[],
  eventId: number,
  userId: number,
): DuoSessionRow | undefined {
  return rows.find((r) => r.event_id === eventId && r.user_id === userId);
}

/** Titles of the events where the pair's voice segments overlapped. */
function sharedEventTitles(
  rows: readonly DuoSessionRow[],
  pair: CoPlayAggregate,
): string[] {
  const titles: string[] = [];
  const eventIds = [...new Set(rows.map((r) => r.event_id))];
  for (const eventId of eventIds) {
    const a = sessionOf(rows, eventId, pair.userIdA);
    const b = sessionOf(rows, eventId, pair.userIdB);
    if (a && b && voiceOverlapMinutes(toSession(a), toSession(b)) > 0) {
      titles.push(a.event_title);
    }
  }
  return titles;
}

function member(
  rows: readonly DuoSessionRow[],
  userId: number,
): SpotlightMember {
  const row = rows.find((r) => r.user_id === userId);
  return { userId, name: row?.user_name ?? '' };
}

/** Pure: this week's session rows → the top pair's candidate, or null. */
export function buildDuoCandidate(
  rows: readonly DuoSessionRow[],
): DuoCandidate | null {
  const pair = topPair(aggregateCoPlay(groupSessionsByEvent(rows), new Map()));
  if (!pair) return null;
  const titles = sharedEventTitles(rows, pair);
  return {
    kind: 'duo',
    members: [member(rows, pair.userIdA), member(rows, pair.userIdB)],
    minutesTogether: pair.totalMinutes,
    eventCount: titles.length,
    eventTitles: titles,
  };
}

/** A2 — duo candidate, or null when no two members shared voice time. */
export async function fetchDuoCandidate(
  db: PostgresJsDatabase<typeof schema>,
): Promise<DuoCandidate | null> {
  const rows = await db.execute<DuoSessionRow>(buildDuoSessionsQuery());
  return buildDuoCandidate(Array.from(rows));
}
