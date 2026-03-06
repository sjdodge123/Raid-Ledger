/**
 * Helpers for roster availability and aggregate game-time queries.
 */
import { eq, and, ne, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  RosterAvailabilityResponse,
  UserWithAvailabilitySlots,
  AggregateGameTimeResponse,
} from '@raid-ledger/contract';
import type { AvailabilityService } from '../availability/availability.service';

/** Computes the time range for availability queries. */
function computeTimeRange(
  event: { startTime: string; endTime: string },
  from?: string,
  to?: string,
): { startTime: string; endTime: string } {
  const bufferMs = 2 * 60 * 60 * 1000;
  return {
    startTime:
      from ||
      new Date(new Date(event.startTime).getTime() - bufferMs).toISOString(),
    endTime:
      to ||
      new Date(new Date(event.endTime).getTime() + bufferMs).toISOString(),
  };
}

type AvailabilityEntry = {
  timeRange: { start: string; end: string };
  status: string;
  gameId: number | null;
  sourceEventId: number | null;
};

/** Maps a single signup row to a UserWithAvailabilitySlots entry. */
function mapSingleSignup(
  user: typeof schema.users.$inferSelect,
  availabilityMap: Map<number, AvailabilityEntry[]>,
): UserWithAvailabilitySlots {
  const slots = (availabilityMap.get(user.id) || []).map((a) => ({
    start: a.timeRange.start,
    end: a.timeRange.end,
    status: a.status,
    gameId: a.gameId,
    sourceEventId: a.sourceEventId,
  }));
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    discordId: user.discordId,
    customAvatarUrl: user.customAvatarUrl,
    slots,
  };
}

/** Maps signups with their availability data into UserWithAvailabilitySlots. */
function mapSignupsToUsers(
  signups: Array<{
    signup: typeof schema.eventSignups.$inferSelect;
    user: typeof schema.users.$inferSelect | null;
  }>,
  availabilityMap: Map<number, AvailabilityEntry[]>,
): UserWithAvailabilitySlots[] {
  return signups
    .filter((s) => s.user !== null)
    .map((s) => mapSingleSignup(s.user!, availabilityMap));
}

/** Fetches signups with joined user data for an event. */
async function fetchSignupsWithUsers(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  return db
    .select({ signup: schema.eventSignups, user: schema.users })
    .from(schema.eventSignups)
    .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .where(eq(schema.eventSignups.eventId, eventId));
}

/** Queries roster availability for an event's signed-up users. */
export async function queryRosterAvailability(
  db: PostgresJsDatabase<typeof schema>,
  availabilityService: AvailabilityService,
  event: { startTime: string; endTime: string },
  eventId: number,
  from?: string,
  to?: string,
): Promise<RosterAvailabilityResponse> {
  const signups = await fetchSignupsWithUsers(db, eventId);
  const { startTime, endTime } = computeTimeRange(event, from, to);
  const timeRange = { start: startTime, end: endTime };
  if (signups.length === 0) return { eventId, timeRange, users: [] };
  const userIds = signups.filter((s) => s.user !== null).map((s) => s.user!.id);
  const availabilityMap = await availabilityService.findForUsersInRange(
    userIds,
    startTime,
    endTime,
  );
  return {
    eventId,
    timeRange,
    users: mapSignupsToUsers(signups, availabilityMap),
  };
}

/** Fetches active signup user IDs for an event. */
async function getActiveSignupUserIds(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<number[]> {
  const signups = await db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        ne(schema.eventSignups.status, 'roached_out'),
        ne(schema.eventSignups.status, 'departed'),
        ne(schema.eventSignups.status, 'declined'),
      ),
    );
  return signups.map((s) => s.userId).filter((id): id is number => id !== null);
}

/** Builds heatmap cells from game time templates. */
function buildHeatmapCells(
  templates: Array<{ dayOfWeek: number; startHour: number }>,
  totalUsers: number,
) {
  const countMap = new Map<string, number>();
  for (const t of templates) {
    const day = (t.dayOfWeek + 1) % 7;
    const key = `${day}:${t.startHour}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }
  return Array.from(countMap.entries()).map(([key, count]) => {
    const [day, hour] = key.split(':').map(Number);
    return {
      dayOfWeek: day,
      hour,
      availableCount: count,
      totalCount: totalUsers,
    };
  });
}

/** Queries aggregate game-time availability for an event's roster. */
export async function queryAggregateGameTime(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<AggregateGameTimeResponse> {
  const userIds = await getActiveSignupUserIds(db, eventId);
  if (userIds.length === 0) return { eventId, totalUsers: 0, cells: [] };
  const templates = await db
    .select({
      dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
      startHour: schema.gameTimeTemplates.startHour,
    })
    .from(schema.gameTimeTemplates)
    .where(inArray(schema.gameTimeTemplates.userId, userIds));
  return {
    eventId,
    totalUsers: userIds.length,
    cells: buildHeatmapCells(templates, userIds.length),
  };
}
