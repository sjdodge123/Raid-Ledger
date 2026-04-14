/**
 * Core entity installation helpers for demo data.
 * Handles users, events, characters, signups, and roster assignments.
 * Extracted from demo-data.service.ts for file size compliance (ROK-719).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  FAKE_GAMERS,
  ORIGINAL_GAMER_COUNT,
  CHARACTERS_CONFIG,
  getClassIconUrl,
  getEventsDefinitions,
  getEdgeCaseDefinitions,
} from './demo-data.constants';
import type { EdgeCaseEvent } from './demo-data.constants';
import {
  generateEvents,
  generateCharacters,
  generateSignups,
  generateGameTime,
  generateAvailability,
  generateNotifications,
  generateNotifPreferences,
  generateGameInterests,
} from './demo-data-generator';

type Db = PostgresJsDatabase<typeof schema>;
type BatchInsertReturning = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
) => Promise<Record<string, unknown>[]>;

/** Create SeedAdmin + fake gamers. */
export async function installUsers(
  batchInsertReturning: BatchInsertReturning,
  db: Db,
) {
  const [seedAdmin] = await db
    .insert(schema.users)
    .values({ username: 'SeedAdmin', role: 'admin' })
    .returning();
  const gamerValues = FAKE_GAMERS.map((g) => ({
    username: g.username,
    avatar: g.avatar,
    role: 'member' as const,
  }));
  const insertedGamers = (await batchInsertReturning(
    schema.users,
    gamerValues,
  )) as (typeof schema.users.$inferSelect)[];
  const allUsers = [seedAdmin, ...insertedGamers];
  const userByName = new Map(allUsers.map((u) => [u.username, u]));
  return { allUsers, userByName };
}

/** Map an edge-case event definition to a DB-ready insert value. */
function mapEdgeCaseEvent(e: EdgeCaseEvent, creatorId: number) {
  return {
    title: e.title,
    description: e.description,
    gameId: e.gameId,
    creatorId,
    duration: [e.startTime, e.endTime] as [Date, Date],
    ...(e.isAdHoc != null && { isAdHoc: e.isAdHoc }),
    ...(e.adHocStatus != null && { adHocStatus: e.adHocStatus }),
    ...(e.cancelledAt != null && { cancelledAt: e.cancelledAt }),
    ...(e.cancellationReason != null && {
      cancellationReason: e.cancellationReason,
    }),
  };
}

/** Insert original + edge-case + generated events. */
export async function installEvents(
  batchInsertReturning: BatchInsertReturning,
  seedAdminId: number,
  allGames: (typeof schema.games.$inferSelect)[],
  generatedEvents: ReturnType<typeof generateEvents>,
) {
  const origEventDefs = getEventsDefinitions(allGames);
  const edgeCaseDefs = getEdgeCaseDefinitions(allGames);
  const origValues = origEventDefs.map((e) => ({
    title: e.title,
    description: e.description,
    gameId: e.gameId,
    creatorId: seedAdminId,
    duration: [e.startTime, e.endTime] as [Date, Date],
  }));
  const edgeValues = edgeCaseDefs.map((e) => mapEdgeCaseEvent(e, seedAdminId));
  const genValues = generatedEvents.map((e) => ({
    title: e.title,
    description: e.description,
    gameId: e.gameId,
    creatorId: seedAdminId,
    duration: [e.startTime, e.endTime] as [Date, Date],
    maxAttendees: e.maxPlayers,
  }));
  const allValues = [...origValues, ...edgeValues, ...genValues];
  const created = (await batchInsertReturning(
    schema.events,
    allValues,
  )) as (typeof schema.events.$inferSelect)[];
  const handcraftedCount = origEventDefs.length + edgeCaseDefs.length;
  const origEvents = created.slice(0, handcraftedCount);
  const genEvents = created.slice(handcraftedCount);
  return { createdEvents: created, origEvents, genEvents };
}

/** Insert original + generated characters. */
export async function installCharacters(
  batchInsertReturning: BatchInsertReturning,
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allGames: (typeof schema.games.$inferSelect)[],
  gamesBySlug: Map<string, typeof schema.games.$inferSelect>,
  generatedChars: ReturnType<typeof generateCharacters>,
) {
  const origCharValues = buildOriginalCharValues(userByName, allGames);
  const genCharValues = buildGeneratedCharValues(
    userByName,
    gamesBySlug,
    generatedChars,
  );
  const createdChars = (await batchInsertReturning(schema.characters, [
    ...origCharValues,
    ...genCharValues,
  ])) as (typeof schema.characters.$inferSelect)[];
  const charByUserGame = new Map<string, string>();
  for (const c of createdChars) {
    const key = `${c.userId}:${c.gameId}`;
    if (!charByUserGame.has(key) || c.isMain) charByUserGame.set(key, c.id);
  }
  return { createdChars, charByUserGame };
}

/** Build original hand-crafted character insert values. */
function buildOriginalCharValues(
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allGames: (typeof schema.games.$inferSelect)[],
): Record<string, unknown>[] {
  const usersWithMain = new Set<string>();
  const values: Record<string, unknown>[] = [];
  for (const charData of CHARACTERS_CONFIG) {
    const user = userByName.get(charData.username);
    const game = allGames[charData.gameIdx];
    if (!user || !game) continue;
    const isMain = !usersWithMain.has(`${charData.username}:${game.id}`);
    usersWithMain.add(`${charData.username}:${game.id}`);
    values.push({
      userId: user.id,
      gameId: game.id,
      name: charData.charName,
      class: charData.class,
      spec: charData.spec,
      role: charData.role,
      isMain,
      avatarUrl: getClassIconUrl(charData.wowClass),
      displayOrder: isMain ? 0 : 1,
    });
  }
  return values;
}

/** Build generated character insert values. */
function buildGeneratedCharValues(
  userByName: Map<string, typeof schema.users.$inferSelect>,
  gamesBySlug: Map<string, typeof schema.games.$inferSelect>,
  generatedChars: ReturnType<typeof generateCharacters>,
): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  for (const c of generatedChars) {
    const user = userByName.get(c.username);
    const game = gamesBySlug.get(c.gameSlug);
    if (!user || !game) continue;
    values.push({
      userId: user.id,
      gameId: game.id,
      name: c.charName,
      class: c.class,
      spec: c.spec,
      role: c.role,
      isMain: c.isMain,
      avatarUrl: c.wowClass ? getClassIconUrl(c.wowClass) : null,
      displayOrder: c.isMain ? 0 : 1,
    });
  }
  return values;
}

/** Build IGDB player count map from game rows. */
export function buildPlayerCountMap(
  allGames: (typeof schema.games.$inferSelect)[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of allGames) {
    const pc = g.playerCount as { min: number; max: number } | null;
    if (pc?.max) map.set(String(g.igdbId), pc.max);
  }
  return map;
}

/** Generate all data in memory. */
export function generateAllData(
  rng: () => number,
  allGames: (typeof schema.games.$inferSelect)[],
  now: Date,
) {
  const igdbPlayerCounts = buildPlayerCountMap(allGames);
  const events = generateEvents(rng, allGames, now, igdbPlayerCounts);
  const generatedUsernames = FAKE_GAMERS.map((g) => g.username);
  const newUsernames = generatedUsernames.slice(ORIGINAL_GAMER_COUNT);
  const chars = generateCharacters(rng, newUsernames);
  const allUsernames = [...generatedUsernames, 'SeedAdmin'];
  return {
    events,
    chars,
    allUsernames,
    generatedUsernames,
    newUsernames,
    signups: generateSignups(rng, events, allUsernames, chars, allGames),
    gameTime: generateGameTime(rng, newUsernames),
    avail: generateAvailability(rng, newUsernames, now),
    notifs: generateNotifications(rng, generatedUsernames, events, now),
    notifPrefs: generateNotifPreferences(rng, generatedUsernames),
    interests: generateGameInterests(
      rng,
      generatedUsernames,
      extractIgdbIds(allGames),
    ),
  };
}

/** Extract non-null IGDB IDs from games. */
export function extractIgdbIds(
  allGames: (typeof schema.games.$inferSelect)[],
): number[] {
  return allGames
    .map((g) => g.igdbId)
    .filter((id): id is number => id !== null);
}
