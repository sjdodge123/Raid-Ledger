import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildAttendanceRowDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

/**
 * ROK-2062 — the community / game_server hub "Attendance leaderboard" rows.
 * A core port of the WoW guild leaderboard (`guild-raids.helpers.ts`
 * `toAttendanceRows`), except a community hub has no roster: every active
 * user whose attendance was recorded on a counted event gets a row, and the
 * name is the user's display name (no character link).
 */

type Db = PostgresJsDatabase<typeof schema>;
const { eventSignups, users } = schema;

/**
 * Row cap for the leaderboard. A community hub has no roster to bound the
 * row count and the Events tab renders every row, so only the top N ship.
 */
export const COMMUNITY_ATTENDANCE_ROW_CAP = 50;

/** Same order as the guild leaderboard: attended desc, then name (case-blind). */
function compareAttendance(
  a: GuildAttendanceRowDto,
  b: GuildAttendanceRowDto,
): number {
  if (a.attended !== b.attended) return b.attended - a.attended;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/**
 * Leaderboard rows over `eventIds` — the hub's counted events (ended, not
 * cancelled, in the window, attendance taken). `of` is the number of those
 * events, shared by every row; no events → no rows. Deactivated users are
 * left out, as the guild leaderboard's roster join does.
 */
export async function loadCommunityAttendanceRows(
  db: Db,
  eventIds: number[],
): Promise<GuildAttendanceRowDto[]> {
  if (eventIds.length === 0) return [];
  const rows = await db
    .select({
      userId: users.id,
      name: sql<string>`coalesce(${users.displayName}, ${users.username})`,
      attended: sql<number>`(count(*) filter (where ${eventSignups.attendanceStatus} = 'attended'))::int`,
    })
    .from(eventSignups)
    .innerJoin(users, eq(users.id, eventSignups.userId))
    .where(
      and(
        inArray(eventSignups.eventId, eventIds),
        sql`${eventSignups.attendanceStatus} is not null`,
        isNull(users.deactivatedAt),
      ),
    )
    .groupBy(users.id);
  const of = eventIds.length;
  return rankAttendanceRows(rows.map((r) => ({ ...r, characterId: null, of })));
}

/**
 * Sorts rows by attended desc then name (case-blind) and keeps the top
 * `cap` — the cap applies AFTER the sort, so it keeps the leaders.
 */
export function rankAttendanceRows(
  rows: GuildAttendanceRowDto[],
  cap: number = COMMUNITY_ATTENDANCE_ROW_CAP,
): GuildAttendanceRowDto[] {
  return [...rows].sort(compareAttendance).slice(0, cap);
}
