/**
 * Availability helpers for scheduling poll heatmap (ROK-965).
 * Builds aggregate game-time cells from templates for match members.
 * Returns AggregateGameTimeResponse shape for GameTimeGrid's heatmapOverlay.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';

type Db = PostgresJsDatabase<typeof schema>;

interface TemplateRow {
  userId: number;
  dayOfWeek: number;
  startHour: number;
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

/** Aggregate templates into day×hour cells with counts. */
function aggregateToCells(
  templates: TemplateRow[],
  totalUsers: number,
): AggregateGameTimeResponse['cells'] {
  const cellMap = new Map<string, number>();
  for (const t of templates) {
    const key = `${t.dayOfWeek}:${t.startHour}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + 1);
  }
  return Array.from(cellMap.entries()).map(([key, count]) => {
    const [day, hour] = key.split(':').map(Number);
    return {
      dayOfWeek: day,
      hour,
      availableCount: count,
      totalCount: totalUsers,
    };
  });
}

/**
 * Build aggregate game-time availability for match members.
 * Returns shape compatible with GameTimeGrid's heatmapOverlay prop.
 */
export async function buildSchedulingAvailability(
  db: Db,
  memberUserIds: number[],
  matchId: number,
): Promise<AggregateGameTimeResponse> {
  if (memberUserIds.length === 0) {
    return { eventId: matchId, totalUsers: 0, cells: [] };
  }
  const templates = await fetchTemplates(db, memberUserIds);
  const cells = aggregateToCells(templates, memberUserIds.length);
  return { eventId: matchId, totalUsers: memberUserIds.length, cells };
}
