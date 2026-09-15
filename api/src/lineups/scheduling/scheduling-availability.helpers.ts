/**
 * Availability helpers for scheduling poll heatmap (ROK-965).
 * Builds aggregate game-time cells from templates for match members.
 * Returns AggregateGameTimeResponse shape for GameTimeGrid's heatmapOverlay.
 *
 * ROK-1560: cells now carry a fresh / stale / unknown split — fill = fresh
 * availability, hatch = stale, `unknownCount` = members with no template at
 * all. A stale member is never counted as available.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import {
  GAME_TIME_FRESHNESS_DAYS,
  gameTimeAgeDays,
  isGameTimeStale,
} from '../../users/game-time-freshness.helpers';
import {
  splitMembersByFreshness,
  aggregateFreshnessCells,
} from './scheduling-availability-freshness.helpers';

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

/** Fetch `users.game_time_confirmed_at` for the given user IDs (ROK-1560). */
async function fetchConfirmedAt(
  db: Db,
  userIds: number[],
): Promise<Map<number, Date | null>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: schema.users.id,
      confirmedAt: schema.users.gameTimeConfirmedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  return new Map(rows.map((r) => [r.userId, r.confirmedAt ?? null]));
}

/**
 * Whole days since the viewer last confirmed game time. `null` = never
 * confirmed; `undefined` = no viewer in this request (keeps the contract's
 * `null` meaning unambiguous).
 */
function viewerAge(
  confirmed: Map<number, Date | null>,
  viewerUserId: number | undefined,
  now: Date,
): number | null | undefined {
  if (!viewerUserId) return undefined;
  return gameTimeAgeDays(confirmed.get(viewerUserId) ?? null, now);
}

/** The server's stale verdict for the viewer — the same rule the fill uses. */
function viewerStale(
  confirmed: Map<number, Date | null>,
  viewerUserId: number | undefined,
  now: Date,
): boolean | undefined {
  if (!viewerUserId) return undefined;
  return isGameTimeStale(confirmed.get(viewerUserId) ?? null, now);
}

/** Empty heatmap for a poll with no members — still reports viewer freshness. */
async function emptyAvailability(
  db: Db,
  matchId: number,
  viewerUserId: number | undefined,
  now: Date,
): Promise<AggregateGameTimeResponse> {
  const confirmed = await fetchConfirmedAt(
    db,
    viewerUserId ? [viewerUserId] : [],
  );
  return {
    eventId: matchId,
    totalUsers: 0,
    cells: [],
    totalMembers: 0,
    freshnessDays: GAME_TIME_FRESHNESS_DAYS,
    untemplatedMembers: 0,
    viewerGameTimeAgeDays: viewerAge(confirmed, viewerUserId, now),
    viewerGameTimeStale: viewerStale(confirmed, viewerUserId, now),
  };
}

/** Pair each member id with their confirmation timestamp and template presence. */
function toFreshnessMembers(
  memberUserIds: number[],
  templates: TemplateRow[],
  confirmed: Map<number, Date | null>,
) {
  const templated = new Set(templates.map((t) => t.userId));
  return memberUserIds.map((userId) => ({
    userId,
    confirmedAt: confirmed.get(userId) ?? null,
    hasTemplate: templated.has(userId),
  }));
}

/**
 * Build aggregate game-time availability for match members.
 * Returns shape compatible with GameTimeGrid's heatmapOverlay prop.
 * Templates and confirmations are independent and fetched concurrently.
 */
export async function buildSchedulingAvailability(
  db: Db,
  memberUserIds: number[],
  matchId: number,
  viewerUserId?: number,
): Promise<AggregateGameTimeResponse> {
  const now = new Date();
  if (memberUserIds.length === 0) {
    return emptyAvailability(db, matchId, viewerUserId, now);
  }
  const lookupIds = Array.from(
    new Set(viewerUserId ? [...memberUserIds, viewerUserId] : memberUserIds),
  );
  const [templates, confirmed] = await Promise.all([
    fetchTemplates(db, memberUserIds),
    fetchConfirmedAt(db, lookupIds),
  ]);
  const members = toFreshnessMembers(memberUserIds, templates, confirmed);
  const split = splitMembersByFreshness(members, now);
  return {
    eventId: matchId,
    totalUsers: memberUserIds.length,
    cells: aggregateFreshnessCells(templates, split, memberUserIds.length),
    totalMembers: memberUserIds.length,
    freshnessDays: GAME_TIME_FRESHNESS_DAYS,
    untemplatedMembers: split.untemplatedIds.length,
    viewerGameTimeAgeDays: viewerAge(confirmed, viewerUserId, now),
    viewerGameTimeStale: viewerStale(confirmed, viewerUserId, now),
  };
}
