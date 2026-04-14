/**
 * Secondary data installation helpers for demo data.
 * Handles availability, game time, notifications, preferences, and interests.
 * Extracted from demo-data.service.ts for file size compliance (ROK-719).
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  FAKE_GAMERS,
  ORIGINAL_GAMER_COUNT,
  ROLE_ACCOUNTS,
  THEME_ASSIGNMENTS,
  getGameTimeDefinitions,
  getAvailabilityDefinitions,
  getNotificationTemplates,
} from './demo-data.constants';
import {
  createRng,
  generateAvailability,
  generateGameTime,
  generateNotifications,
  generateNotifPreferences,
  generateGameInterests,
} from './demo-data-generator';

type Db = PostgresJsDatabase<typeof schema>;
type BatchInsert = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
  onConflict?: 'doNothing',
) => Promise<void>;

/** Type guard for filtering out nulls. */
function nonNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Deduplicate an array by a key function, keeping first occurrence. */
function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = keyFn(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()];
}

/** Map a game-time slot to a DB-ready value using the user map. */
function mapGameTimeSlot(userByName: Map<string, { id: number }>) {
  return (slot: { username: string; dayOfWeek: number; startHour: number }) => {
    const user = userByName.get(slot.username);
    if (!user) return null;
    return {
      userId: user.id,
      dayOfWeek: slot.dayOfWeek,
      startHour: slot.startHour,
    };
  };
}

/** Insert availability data. */
export async function installAvailability(
  batchInsert: BatchInsert,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  generatedAvail: ReturnType<typeof generateAvailability>,
) {
  const mapAvail = (a: {
    username: string;
    start: Date;
    end: Date;
    status: string;
  }) => {
    const user = userByName.get(a.username);
    if (!user) return null;
    return {
      userId: user.id,
      timeRange: [a.start, a.end] as [Date, Date],
      status: a.status,
    };
  };
  const origAvailValues = getAvailabilityDefinitions()
    .map(mapAvail)
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const genAvailValues = generatedAvail
    .map(mapAvail)
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const allAvailValues = [...origAvailValues, ...genAvailValues];
  if (allAvailValues.length > 0)
    await batchInsert(schema.availability, allAvailValues);
  return allAvailValues;
}

/** Insert game time templates. */
export async function installGameTime(
  batchInsert: BatchInsert,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  generatedGameTime: ReturnType<typeof generateGameTime>,
) {
  const mapSlot = mapGameTimeSlot(userByName);
  const origValues = getGameTimeDefinitions().map(mapSlot).filter(nonNull);
  const genValues = generatedGameTime.map(mapSlot).filter(nonNull);
  const uniqueGameTime = dedupeByKey(
    [...origValues, ...genValues],
    (gt) => `${gt.userId}:${gt.dayOfWeek}:${gt.startHour}`,
  );
  if (uniqueGameTime.length > 0)
    await batchInsert(schema.gameTimeTemplates, uniqueGameTime, 'doNothing');
  return uniqueGameTime;
}

/** Insert notifications. */
export async function installNotifications(
  batchInsert: BatchInsert,
  db: Db,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allUsers: (typeof schema.users.$inferSelect)[],
  origEvents: (typeof schema.events.$inferSelect)[],
  generatedNotifs: ReturnType<typeof generateNotifications>,
): Promise<number> {
  let count = 0;
  count += await insertAdminNotifications(
    batchInsert,
    db,
    origEvents,
    allUsers,
  );
  count += await insertGeneratedNotifications(
    batchInsert,
    userByName,
    generatedNotifs,
  );
  return count;
}

/** Insert admin-targeted notification templates. */
async function insertAdminNotifications(
  batchInsert: BatchInsert,
  db: Db,
  origEvents: (typeof schema.events.$inferSelect)[],
  allUsers: (typeof schema.users.$inferSelect)[],
): Promise<number> {
  const [adminUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, 'roknua'))
    .limit(1);
  if (!adminUser) return 0;
  const templates = getNotificationTemplates(
    adminUser.id,
    origEvents,
    allUsers.slice(1),
  );
  if (templates.length > 0) await batchInsert(schema.notifications, templates);
  return templates.length;
}

/** Insert generated notification values. */
async function insertGeneratedNotifications(
  batchInsert: BatchInsert,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  generatedNotifs: ReturnType<typeof generateNotifications>,
): Promise<number> {
  const genValues = generatedNotifs
    .map((n) => {
      const user = userByName.get(n.username);
      if (!user) return null;
      return {
        userId: user.id,
        type: n.type,
        title: n.title,
        message: n.message,
        payload: n.payload,
        createdAt: n.createdAt,
        readAt: n.readAt,
      };
    })
    .filter(nonNull);
  if (genValues.length > 0) await batchInsert(schema.notifications, genValues);
  return genValues.length;
}

/** Insert notification + theme preferences. */
export async function installPreferences(
  batchInsert: BatchInsert,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allUsers: (typeof schema.users.$inferSelect)[],
  generatedNotifPrefs: ReturnType<typeof generateNotifPreferences>,
): Promise<void> {
  await installNotifPreferences(batchInsert, allUsers, generatedNotifPrefs);
  await installThemePreferences(batchInsert, userByName);
}

/** Insert notification channel preferences for all users. */
async function installNotifPreferences(
  batchInsert: BatchInsert,
  allUsers: (typeof schema.users.$inferSelect)[],
  generatedNotifPrefs: ReturnType<typeof generateNotifPreferences>,
): Promise<void> {
  const prefsByUsername = new Map(
    generatedNotifPrefs.map((p) => [p.username, p.channelPrefs]),
  );
  const values = allUsers.map((u) => {
    const customPrefs = prefsByUsername.get(u.username);
    return customPrefs
      ? {
          userId: u.id,
          channelPrefs: customPrefs as unknown as schema.ChannelPrefs,
        }
      : { userId: u.id };
  });
  await batchInsert(schema.userNotificationPreferences, values, 'doNothing');
}

/** Insert theme preferences for hand-crafted + generated users. */
async function installThemePreferences(
  batchInsert: BatchInsert,
  userByName: Map<string, typeof schema.users.$inferSelect>,
): Promise<void> {
  const values: Record<string, unknown>[] = [];
  for (const [username, theme] of Object.entries(THEME_ASSIGNMENTS)) {
    const user = userByName.get(username);
    if (user) values.push({ userId: user.id, key: 'theme', value: theme });
  }
  const themes = ['default-dark', 'default-light', 'auto'];
  const themeRng = createRng(0xc0101);
  for (const gamer of FAKE_GAMERS.slice(ORIGINAL_GAMER_COUNT)) {
    const user = userByName.get(gamer.username);
    if (user)
      values.push({
        userId: user.id,
        key: 'theme',
        value: themes[Math.floor(themeRng() * themes.length)],
      });
  }
  if (values.length > 0)
    await batchInsert(schema.userPreferences, values, 'doNothing');
}

/** Insert game interests. */
export async function installGameInterests(
  batchInsert: BatchInsert,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  igdbIdsByDbId: Map<number | null, number>,
  generatedInterests: ReturnType<typeof generateGameInterests>,
): Promise<void> {
  const values = generatedInterests
    .map((gi) => {
      const user = userByName.get(gi.username);
      const gameDbId = igdbIdsByDbId.get(gi.igdbId);
      if (!user || !gameDbId) return null;
      return { userId: user.id, gameId: gameDbId };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const deduped = new Map<string, (typeof values)[0]>();
  for (const gi of values) deduped.set(`${gi.userId}:${gi.gameId}`, gi);
  const unique = [...deduped.values()];
  if (unique.length > 0)
    await batchInsert(schema.gameInterests, unique, 'doNothing');
}

/** Reassign some events to non-admin creators. */
export async function reassignEventCreators(
  db: Db,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allUsers: (typeof schema.users.$inferSelect)[],
  origEvents: (typeof schema.events.$inferSelect)[],
  genEvents: (typeof schema.events.$inferSelect)[],
): Promise<void> {
  await reassignOrigEventsToRaidLeader(db, userByName, origEvents);
  await reassignGenEventsRandomly(db, allUsers, genEvents);
}

/** Reassign ALL original events round-robin across raid leaders. */
async function reassignOrigEventsToRaidLeader(
  db: Db,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  origEvents: (typeof schema.events.$inferSelect)[],
): Promise<void> {
  const raidLeaders = ROLE_ACCOUNTS.filter((a) => a.role === 'Raid Leader');
  const byLeader = new Map<number, number[]>();
  for (let i = 0; i < origEvents.length; i++) {
    const leader = raidLeaders[i % raidLeaders.length];
    const user = userByName.get(leader.username);
    if (!user) continue;
    const ids = byLeader.get(user.id) ?? [];
    ids.push(origEvents[i].id);
    byLeader.set(user.id, ids);
  }
  for (const [creatorId, eventIds] of byLeader) {
    await db
      .update(schema.events)
      .set({ creatorId })
      .where(inArray(schema.events.id, eventIds));
  }
}

/** Reassign ALL generated events to non-admin creators (round-robin). */
async function reassignGenEventsRandomly(
  db: Db,
  allUsers: (typeof schema.users.$inferSelect)[],
  genEvents: (typeof schema.events.$inferSelect)[],
): Promise<void> {
  const nonAdminUsers = allUsers.filter((u) => u.role !== 'admin');
  if (nonAdminUsers.length === 0) return;
  const reassignByCreator = new Map<number, number[]>();
  for (let i = 0; i < genEvents.length; i++) {
    const creator = nonAdminUsers[i % nonAdminUsers.length];
    const ids = reassignByCreator.get(creator.id) ?? [];
    ids.push(genEvents[i].id);
    reassignByCreator.set(creator.id, ids);
  }
  for (const [creatorId, eventIds] of reassignByCreator) {
    await db
      .update(schema.events)
      .set({ creatorId })
      .where(inArray(schema.events.id, eventIds));
  }
}
