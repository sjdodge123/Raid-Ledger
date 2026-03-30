/**
 * Availability helpers for scheduling poll heatmap (ROK-965).
 * Builds heatmap-compatible data from game time templates for match members.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { RosterAvailabilityResponse } from '@raid-ledger/contract';

type Db = PostgresJsDatabase<typeof schema>;

interface TemplateRow {
  userId: number;
  dayOfWeek: number;
  startHour: number;
}

/** Map a day + hour into an ISO datetime slot for a reference week. */
function buildSlotFromTemplate(
  t: TemplateRow,
  refMonday: Date,
): { start: string; end: string } {
  const d = new Date(refMonday);
  d.setDate(d.getDate() + t.dayOfWeek);
  d.setHours(t.startHour, 0, 0, 0);
  const end = new Date(d.getTime() + 60 * 60 * 1000);
  return { start: d.toISOString(), end: end.toISOString() };
}

/** Get the Monday of the current week (UTC). */
function getCurrentMonday(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + offset);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

/** Fetch game time templates for given user IDs. */
async function fetchTemplates(
  db: Db,
  userIds: number[],
): Promise<TemplateRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: schema.gameTimeTemplates.userId,
      dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
      startHour: schema.gameTimeTemplates.startHour,
    })
    .from(schema.gameTimeTemplates)
    .where(inArray(schema.gameTimeTemplates.userId, userIds));
}

/** Fetch user info for given IDs. */
async function fetchUsers(db: Db, userIds: number[]) {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      discordId: schema.users.discordId,
      customAvatarUrl: schema.users.customAvatarUrl,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
}

/**
 * Build heatmap-compatible availability from game time templates.
 * Uses a synthetic "reference week" time range so the HeatmapGrid
 * can render day-of-week x hour cells.
 */
export async function buildSchedulingAvailability(
  db: Db,
  memberUserIds: number[],
  matchId: number,
): Promise<RosterAvailabilityResponse> {
  const refMonday = getCurrentMonday();
  const refEnd = new Date(refMonday);
  refEnd.setDate(refEnd.getDate() + 7);

  const timeRange = {
    start: refMonday.toISOString(),
    end: refEnd.toISOString(),
  };

  if (memberUserIds.length === 0) {
    return { eventId: matchId, timeRange, users: [] };
  }

  const [templates, userRows] = await Promise.all([
    fetchTemplates(db, memberUserIds),
    fetchUsers(db, memberUserIds),
  ]);

  const templatesByUser = new Map<number, TemplateRow[]>();
  for (const t of templates) {
    const existing = templatesByUser.get(t.userId) ?? [];
    existing.push(t);
    templatesByUser.set(t.userId, existing);
  }

  const users = userRows.map((u) => {
    const userTemplates = templatesByUser.get(u.id) ?? [];
    const slots = userTemplates.map((t) => ({
      ...buildSlotFromTemplate(t, refMonday),
      status: 'available' as const,
      gameId: null,
      sourceEventId: null,
    }));
    return { ...u, slots };
  });

  return { eventId: matchId, timeRange, users };
}
