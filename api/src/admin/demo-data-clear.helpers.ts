/**
 * Demo data clearing and counting helpers.
 * Extracted from demo-data.service.ts for file size compliance (ROK-719).
 */
import { inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { DemoDataCountsDto } from '@raid-ledger/contract';
import {
  DEMO_USERNAMES,
  DEMO_NOTIFICATION_TITLES,
} from './demo-data.constants';
import type { SettingsService } from '../settings/settings.service';

type Db = PostgresJsDatabase<typeof schema>;

export function emptyCounts(): DemoDataCountsDto {
  return {
    users: 0,
    events: 0,
    characters: 0,
    signups: 0,
    availability: 0,
    gameTimeSlots: 0,
    notifications: 0,
  };
}

/** Count demo entities by querying for DEMO_USERNAMES. */
export async function getCounts(db: Db): Promise<DemoDataCountsDto> {
  const demoUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.username, [...DEMO_USERNAMES] as string[]));
  const demoUserIds = demoUsers.map((u) => u.id);
  if (demoUserIds.length === 0) return emptyCounts();
  return countDemoEntities(db, demoUserIds);
}

/** Count all demo entity types in parallel. */
async function countDemoEntities(
  db: Db,
  ids: number[],
): Promise<DemoDataCountsDto> {
  const [
    events,
    characters,
    signups,
    availability,
    gameTimeSlots,
    notifications,
  ] = await Promise.all(buildDemoCountQueries(db, ids));
  return {
    users: ids.length,
    events,
    characters,
    signups,
    availability,
    gameTimeSlots,
    notifications,
  };
}

/** Build the parallel count queries for demo entities. */
function buildDemoCountQueries(db: Db, ids: number[]) {
  return [
    countRows(db, schema.events, inArray(schema.events.creatorId, ids)),
    countRows(db, schema.characters, inArray(schema.characters.userId, ids)),
    countRows(
      db,
      schema.eventSignups,
      inArray(schema.eventSignups.userId, ids),
    ),
    countRows(
      db,
      schema.availability,
      inArray(schema.availability.userId, ids),
    ),
    countRows(
      db,
      schema.gameTimeTemplates,
      inArray(schema.gameTimeTemplates.userId, ids),
    ),
    countRows(
      db,
      schema.notifications,
      inArray(schema.notifications.userId, ids),
    ),
  ] as const;
}

/** Count rows matching a where condition. */
async function countRows(
  db: Db,
  table: Parameters<Db['insert']>[0],
  condition: ReturnType<typeof inArray>,
): Promise<number> {
  const c = sql<number>`count(*)::int`;
  const rows: { count: number }[] = await db
    .select({ count: c })
    .from(table as never)
    .where(condition);
  return rows[0]?.count ?? 0;
}

/** Execute the actual clear operations in FK-safe order. */
export async function performClear(
  db: Db,
  settingsService: SettingsService,
): Promise<void> {
  const demoUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.username, [...DEMO_USERNAMES] as string[]));
  const demoUserIds = demoUsers.map((u) => u.id);
  if (demoUserIds.length > 0) {
    await deleteDemoUserData(db, demoUserIds);
  }
  await db
    .delete(schema.notifications)
    .where(
      inArray(schema.notifications.title, [
        ...DEMO_NOTIFICATION_TITLES,
      ] as string[]),
    );
  await settingsService.setDemoMode(false);
}

/** Delete all data associated with demo user IDs in FK-safe order. */
async function deleteDemoUserData(
  db: Db,
  demoUserIds: number[],
): Promise<void> {
  const demoEventIds = await fetchDemoEventIds(db, demoUserIds);
  if (demoEventIds.length > 0) {
    await db
      .update(schema.availability)
      .set({ sourceEventId: null })
      .where(inArray(schema.availability.sourceEventId, demoEventIds));
  }
  await deleteDemoUserDependents(db, demoUserIds, demoEventIds);
}

async function fetchDemoEventIds(db: Db, demoUserIds: number[]) {
  const demoEvents = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(inArray(schema.events.creatorId, demoUserIds));
  return demoEvents.map((e) => e.id);
}

async function deleteDemoUserDependents(
  db: Db,
  demoUserIds: number[],
  demoEventIds: number[],
): Promise<void> {
  await db
    .delete(schema.availability)
    .where(inArray(schema.availability.userId, demoUserIds));
  await db
    .delete(schema.sessions)
    .where(inArray(schema.sessions.userId, demoUserIds));
  await db
    .delete(schema.localCredentials)
    .where(inArray(schema.localCredentials.userId, demoUserIds));
  if (demoEventIds.length > 0) {
    await db
      .delete(schema.events)
      .where(inArray(schema.events.id, demoEventIds));
  }
  await db.delete(schema.users).where(inArray(schema.users.id, demoUserIds));
}
