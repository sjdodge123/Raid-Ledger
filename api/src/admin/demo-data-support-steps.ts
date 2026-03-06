/**
 * Demo data support data insertion steps (availability, game time, etc).
 */
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Subset of DemoDataService needed by support steps. */
interface DemoDataDeps {
  database: PostgresJsDatabase<typeof schema>;
  batchInsert(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    rows: Record<string, unknown>[],
    onConflict?: 'doNothing',
  ): Promise<void>;
}
import {
  FAKE_GAMERS,
  ORIGINAL_GAMER_COUNT,
  THEME_ASSIGNMENTS,
  getGameTimeDefinitions,
  getAvailabilityDefinitions,
  getNotificationTemplates,
} from './demo-data.constants';
import { createRng } from './demo-data-generator';
import {
  mapAvailValues,
  mapAndDedupeGameTime,
  mapNotifValues,
  mapAndDedupeInterests,
} from './demo-data-install.helpers';
import type { GeneratedData } from './demo-data-install-steps';

type UserRow = typeof schema.users.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;

/** Insert availability and game time data. */
async function insertAvailAndGameTime(
  svc: DemoDataDeps,
  userByName: Map<string, UserRow>,
  gen: GeneratedData,
): Promise<void> {
  const origAvail = getAvailabilityDefinitions();
  const allAvail = [
    ...mapAvailValues(origAvail, userByName),
    ...mapAvailValues(gen.avail, userByName),
  ];
  if (allAvail.length > 0) await svc.batchInsert(schema.availability, allAvail);
  const uniqueGT = mapAndDedupeGameTime(
    getGameTimeDefinitions(),
    gen.gameTime,
    userByName,
  );
  if (uniqueGT.length > 0) {
    await svc.batchInsert(schema.gameTimeTemplates, uniqueGT, 'doNothing');
  }
}

/** Insert availability, game time, notifications, preferences, interests. */
export async function insertSupportData(
  svc: DemoDataDeps,
  userByName: Map<string, UserRow>,
  allUsers: UserRow[],
  origEvents: EventRow[],
  igdbIdsByDbId: Map<number | null, number>,
  gen: GeneratedData,
): Promise<void> {
  await insertAvailAndGameTime(svc, userByName, gen);
  await insertNotifications(svc, userByName, allUsers, origEvents, gen);
  await insertPreferences(svc, userByName, allUsers, gen);
  const interests = mapAndDedupeInterests(
    gen.interests,
    userByName,
    igdbIdsByDbId,
  );
  if (interests.length > 0) {
    await svc.batchInsert(schema.gameInterests, interests, 'doNothing');
  }
}

/** Insert admin + generated notifications. */
async function insertNotifications(
  svc: DemoDataDeps,
  userByName: Map<string, UserRow>,
  allUsers: UserRow[],
  origEvents: EventRow[],
  gen: GeneratedData,
): Promise<void> {
  const db = svc.database;
  const [adminUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, 'roknua'))
    .limit(1);
  if (adminUser) {
    const templates = getNotificationTemplates(
      adminUser.id,
      origEvents,
      allUsers.slice(1),
    );
    if (templates.length > 0)
      await svc.batchInsert(schema.notifications, templates);
  }
  const genNotifs = mapNotifValues(gen.notifs, userByName);
  if (genNotifs.length > 0)
    await svc.batchInsert(schema.notifications, genNotifs);
}

/** Insert notification prefs + theme prefs. */
async function insertPreferences(
  svc: DemoDataDeps,
  userByName: Map<string, UserRow>,
  allUsers: UserRow[],
  gen: GeneratedData,
): Promise<void> {
  const prefsByUsername = new Map(
    gen.notifPrefs.map((p) => [p.username, p.channelPrefs]),
  );
  const notifPrefValues = allUsers.map((u) => {
    const custom = prefsByUsername.get(u.username);
    return custom
      ? { userId: u.id, channelPrefs: custom as unknown as schema.ChannelPrefs }
      : { userId: u.id };
  });
  await svc.batchInsert(
    schema.userNotificationPreferences,
    notifPrefValues,
    'doNothing',
  );
  await insertThemePrefs(svc, userByName);
}

/** Insert theme preferences for all users. */
async function insertThemePrefs(
  svc: DemoDataDeps,
  userByName: Map<string, { id: number }>,
): Promise<void> {
  const values: Record<string, unknown>[] = [];
  for (const [username, theme] of Object.entries(THEME_ASSIGNMENTS)) {
    const user = userByName.get(username);
    if (user) values.push({ userId: user.id, key: 'theme', value: theme });
  }
  const themes = ['default-dark', 'default-light', 'auto'];
  const rng = createRng(0xc0101);
  for (const gamer of FAKE_GAMERS.slice(ORIGINAL_GAMER_COUNT)) {
    const user = userByName.get(gamer.username);
    if (user) {
      const theme = themes[Math.floor(rng() * themes.length)];
      values.push({ userId: user.id, key: 'theme', value: theme });
    }
  }
  if (values.length > 0) {
    await svc.batchInsert(schema.userPreferences, values, 'doNothing');
  }
}
