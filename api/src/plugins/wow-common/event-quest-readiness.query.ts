/**
 * ROK-1911 (H9 of ROK-1905): batched reads for the roster-wide quest
 * readiness endpoint — the event row, its active roster (≤100, one query) and
 * every manual progress row on the event (one query). Snapshots load in one
 * batch via `loadForeverCharSnapshots`.
 */
import { and, asc, eq, isNotNull, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { INACTIVE_SIGNUP_STATUSES } from './event-forever-progress.query';
import {
  MAX_READINESS_SIGNUPS,
  type ReadinessSignup,
} from './event-quest-readiness.helpers';
import type { ManualProgressRow } from './quest-progress-addon.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** What access + the Forever gate need about the event. */
export interface ReadinessEvent {
  guildId: number | null;
  slug: string | null;
  contentInstances: unknown;
}

/** The event's guild tag, game slug and content; null when missing. */
export async function loadReadinessEvent(
  db: Db,
  eventId: number,
): Promise<ReadinessEvent | null> {
  const [row] = await db
    .select({
      guildId: schema.events.guildId,
      slug: schema.games.slug,
      contentInstances: schema.events.contentInstances,
    })
    .from(schema.events)
    .leftJoin(schema.games, eq(schema.games.id, schema.events.gameId))
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ?? null;
}

/** Active (D8) signups condition, optionally for one user. */
function activeSignups(eventId: number, userId?: number) {
  const s = schema.eventSignups;
  return and(
    eq(s.eventId, eventId),
    notInArray(s.status, INACTIVE_SIGNUP_STATUSES),
    isNotNull(s.userId),
    userId === undefined ? undefined : eq(s.userId, userId),
  );
}

/** Whether `userId` holds an active signup on the event. */
export async function hasActiveSignup(
  db: Db,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.eventSignups.id })
    .from(schema.eventSignups)
    .where(activeSignups(eventId, userId))
    .limit(1);
  return rows.length > 0;
}

/** Every active signup (≤100), character optional, in signup order. */
export async function loadReadinessRoster(
  db: Db,
  eventId: number,
): Promise<ReadinessSignup[]> {
  const s = schema.eventSignups;
  const c = schema.characters;
  const rows = await db
    .select({
      userId: schema.users.id,
      username: schema.users.username,
      characterId: c.id,
      characterName: c.name,
      charClass: c.class,
      charRace: c.race,
    })
    .from(s)
    .innerJoin(schema.users, eq(schema.users.id, s.userId))
    .leftJoin(c, eq(c.id, s.characterId))
    .where(activeSignups(eventId))
    .orderBy(asc(s.id))
    .limit(MAX_READINESS_SIGNUPS);
  return rows;
}

/** Every manual progress row on the event, all users, one query. */
export async function loadEventManualRows(
  db: Db,
  eventId: number,
): Promise<ManualProgressRow[]> {
  const p = schema.wowClassicQuestProgress;
  return db
    .select({
      id: p.id,
      userId: p.userId,
      questId: p.questId,
      pickedUp: p.pickedUp,
      completed: p.completed,
      updatedAt: p.updatedAt,
    })
    .from(p)
    .where(eq(p.eventId, eventId));
}
