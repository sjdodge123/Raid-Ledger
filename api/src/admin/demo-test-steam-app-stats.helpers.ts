/**
 * ROK-1953 §4.5 — the DEMO_MODE Steam stats fixture for a BG3 community hub.
 * No Steam calls: an app row + 6 invented achievements (2 hidden, one hidden
 * below 5 %), four crew members A–D (A: `ok`, both hidden unlocked; B: `ok`,
 * no hidden; C: `private`; D: unlinked with a kept row + unlock that the feeds
 * must drop) and `steam_library` playtime. Re-running resets the four users.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { STEAM_STATS_APP_IDS } from '../plugins/core/steam-stats/steam-stats.constants';

type Db = PostgresJsDatabase<typeof schema>;

export const BG3_APP_ID = 1086940;
const BG3_SLUGS: ReadonlySet<string> = new Set([
  'baldurs-gate-3',
  'baldurs-gate-iii',
]);

/** The four seeded roles → the community-hubs seed users they reuse. */
export const STEAM_SEED_ROLES = {
  a: 'community-member-1',
  b: 'community-member-2',
  c: 'community-member-3',
  d: 'community-member-4',
} as const;
export type SteamSeedRole = keyof typeof STEAM_SEED_ROLES;

interface SeedAchievement {
  apiName: string;
  name: string;
  description: string;
  hidden: boolean;
  globalPct: string;
}

export const SEED_ACHIEVEMENTS: readonly SeedAchievement[] = [
  {
    apiName: 'DEMO_ACT_ONE',
    name: 'Act One',
    description: 'Finish Act One.',
    hidden: false,
    globalPct: '78.200',
  },
  {
    apiName: 'DEMO_ACT_TWO',
    name: 'Act Two',
    description: 'Finish Act Two.',
    hidden: false,
    globalPct: '52.400',
  },
  {
    apiName: 'DEMO_ACT_THREE',
    name: 'Act Three',
    description: 'Finish Act Three.',
    hidden: false,
    globalPct: '31.900',
  },
  {
    apiName: 'DEMO_COLLECTOR',
    name: 'Collector',
    description: 'Find every relic.',
    hidden: false,
    globalPct: '9.800',
  },
  {
    apiName: 'DEMO_SECRET_ENDING',
    name: 'Demo Secret Ending',
    description: 'Demo spoiler: the hidden ending.',
    hidden: true,
    globalPct: '2.700',
  },
  {
    apiName: 'DEMO_SECRET_ROMANCE',
    name: 'Demo Secret Romance',
    description: 'Demo spoiler: the hidden romance.',
    hidden: true,
    globalPct: '18.600',
  },
];

/** Per role: status, unlocks (api name → hours ago), playtime minutes. */
export const SEED_PLAN: Record<
  SteamSeedRole,
  {
    status: 'ok' | 'private';
    unlocks: Record<string, number>;
    minutes: number | null;
  }
> = {
  a: {
    status: 'ok',
    unlocks: {
      DEMO_ACT_ONE: 300,
      DEMO_ACT_TWO: 120,
      DEMO_ACT_THREE: 30,
      DEMO_SECRET_ROMANCE: 20,
      DEMO_SECRET_ENDING: 5,
    },
    minutes: 7260,
  },
  b: {
    status: 'ok',
    unlocks: { DEMO_ACT_ONE: 200, DEMO_COLLECTOR: 50, DEMO_ACT_TWO: 10 },
    minutes: 2400,
  },
  c: { status: 'private', unlocks: {}, minutes: null },
  // Unlinked after this row was written: kept, but never in a feed (D6).
  d: { status: 'ok', unlocks: { DEMO_ACT_ONE: 1 }, minutes: 300 },
};

/** A fake, stable 17-digit Steam id per user (never a real account). */
export function fakeSteamId(userId: number): string {
  return `7656119${String(userId).padStart(10, '0')}`;
}

async function findSeedHub(db: Db, guildId: number) {
  const [hub] = await db
    .select({
      kind: schema.guilds.kind,
      gameId: schema.guilds.gameId,
      slug: schema.games.slug,
      appId: schema.games.steamAppId,
    })
    .from(schema.guilds)
    .leftJoin(schema.games, eq(schema.games.id, schema.guilds.gameId))
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  return hub;
}

function enabledOr400(appId: number): number {
  if (!STEAM_STATS_APP_IDS.has(appId)) {
    throw new BadRequestException('seed a BG3 hub');
  }
  return appId;
}

/**
 * The hub's game app id, setting BG3's (`manual`) when the game is a BG3
 * slug with no id yet. 400 for anything that is not an enabled BG3 hub.
 */
export async function resolveSeedApp(
  db: Db,
  guildId: number,
): Promise<{ gameId: number; appId: number }> {
  const hub = await findSeedHub(db, guildId);
  if (!hub) throw new NotFoundException('Guild not found');
  if (
    hub.kind !== 'game_community' ||
    hub.gameId === null ||
    hub.slug === null ||
    !BG3_SLUGS.has(hub.slug)
  ) {
    throw new BadRequestException('seed a BG3 community hub');
  }
  if (hub.appId !== null) {
    return { gameId: hub.gameId, appId: enabledOr400(hub.appId) };
  }
  await db
    .update(schema.games)
    .set({ steamAppId: BG3_APP_ID, steamAppIdSource: 'manual' })
    .where(eq(schema.games.id, hub.gameId));
  return { gameId: hub.gameId, appId: BG3_APP_ID };
}

/** The app row + its achievements (replaced wholesale). */
export async function seedAppSchema(db: Db, appId: number): Promise<void> {
  const app = {
    appId,
    achievementCount: SEED_ACHIEVEMENTS.length,
    schemaStatus: 'ok' as const,
    schemaFetchedAt: new Date(),
  };
  await db
    .insert(schema.steamAppStatsApps)
    .values(app)
    .onConflictDoUpdate({ target: schema.steamAppStatsApps.appId, set: app });
  await db
    .delete(schema.steamAppAchievements)
    .where(eq(schema.steamAppAchievements.appId, appId));
  await db
    .insert(schema.steamAppAchievements)
    .values(SEED_ACHIEVEMENTS.map((a) => ({ ...a, appId })));
}

/** Clear the seeded users' rows for the app, then write role `role`'s plan. */
export async function seedMemberStats(
  db: Db,
  ids: { appId: number; gameId: number; userId: number },
  role: SteamSeedRole,
): Promise<void> {
  const { appId, gameId, userId } = ids;
  const plan = SEED_PLAN[role];
  await clearUser(db, userId, appId, gameId);
  await db
    .update(schema.users)
    .set({ steamId: role === 'd' ? null : fakeSteamId(userId) })
    .where(eq(schema.users.id, userId));
  const count = plan.status === 'ok' ? Object.keys(plan.unlocks).length : null;
  await db
    .insert(schema.steamUserAppStats)
    .values({ userId, appId, status: plan.status, unlockedCount: count });
  await writeUnlocksAndPlaytime(db, ids, plan);
}

async function clearUser(
  db: Db,
  userId: number,
  appId: number,
  gameId: number,
): Promise<void> {
  const s = schema.steamUserAppStats;
  const ua = schema.steamUserAchievements;
  const gi = schema.gameInterests;
  await db.delete(s).where(and(eq(s.userId, userId), eq(s.appId, appId)));
  await db.delete(ua).where(and(eq(ua.userId, userId), eq(ua.appId, appId)));
  await db
    .delete(gi)
    .where(
      and(
        eq(gi.userId, userId),
        eq(gi.gameId, gameId),
        inArray(gi.source, ['steam_library']),
      ),
    );
}

async function writeUnlocksAndPlaytime(
  db: Db,
  ids: { appId: number; gameId: number; userId: number },
  plan: (typeof SEED_PLAN)[SteamSeedRole],
): Promise<void> {
  const { appId, gameId, userId } = ids;
  const now = Date.now();
  const unlocks = Object.entries(plan.unlocks).map(([apiName, h]) => ({
    userId,
    appId,
    apiName,
    unlockedAt: new Date(now - h * 3_600_000),
  }));
  if (unlocks.length > 0)
    await db.insert(schema.steamUserAchievements).values(unlocks);
  if (plan.minutes !== null) {
    await db.insert(schema.gameInterests).values({
      userId,
      gameId,
      source: 'steam_library',
      playtimeForever: plan.minutes,
    });
  }
}
