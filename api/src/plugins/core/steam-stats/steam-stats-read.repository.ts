import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { SteamAppSchemaStatus } from '../../../drizzle/schema/steam-app-stats';
import type { StoredAchievement } from './steam-stats.mask';
import type { StoredMemberStats } from './steam-stats-read.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The hub's kind and its game's Steam app id (D1 availability input). */
export interface HubSteamTarget {
  kind: GuildKind;
  gameId: number | null;
  appId: number | null;
}

/** The nightly refresh's per-app state. */
export interface AppState {
  achievementCount: number;
  schemaStatus: SteamAppSchemaStatus;
  schemaFetchedAt: Date | null;
}

/** One user row with their stats + `steam_library` playtime for the hub game. */
export interface MemberRow {
  userId: number;
  username: string;
  displayName: string | null;
  customAvatarUrl: string | null;
  steamId: string | null;
  stats: StoredMemberStats | undefined;
  playtimeMinutes: number | null;
}

/** An unlock joined to its achievement (only rows with a real time). */
export interface UnlockRow {
  userId: number;
  unlockedAt: Date;
  achievement: StoredAchievement;
}

const ach = schema.steamAppAchievements;
const ua = schema.steamUserAchievements;
const UNLOCK_COLUMNS = {
  userId: ua.userId,
  unlockedAt: ua.unlockedAt,
  apiName: ach.apiName,
  name: ach.name,
  description: ach.description,
  hidden: ach.hidden,
  globalPct: ach.globalPct,
};

const u = schema.users;
const s = schema.steamUserAppStats;
const gi = schema.gameInterests;
const MEMBER_COLUMNS = {
  userId: u.id,
  username: u.username,
  displayName: u.displayName,
  customAvatarUrl: u.customAvatarUrl,
  steamId: u.steamId,
  status: s.status,
  unlockedCount: s.unlockedCount,
  fetchedAt: s.fetchedAt,
  playtimeMinutes: gi.playtimeForever,
};

type RawUnlock = {
  userId: number;
  unlockedAt: Date | null;
} & StoredAchievement;

/** ROK-1953 §4.4 — the read route's queries (no writes). */
@Injectable()
export class SteamStatsReadRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The hub's kind + game app id; `undefined` for a missing hub. */
  async hubTarget(guildId: number): Promise<HubSteamTarget | undefined> {
    const g = schema.guilds;
    const [row] = await this.db
      .select({
        kind: g.kind,
        gameId: g.gameId,
        appId: schema.games.steamAppId,
      })
      .from(g)
      .leftJoin(schema.games, eq(schema.games.id, g.gameId))
      .where(eq(g.id, guildId))
      .limit(1);
    return row;
  }

  /** The app's schema state; `undefined` before the first nightly run. */
  async appState(appId: number): Promise<AppState | undefined> {
    const a = schema.steamAppStatsApps;
    const [row] = await this.db
      .select({
        achievementCount: a.achievementCount,
        schemaStatus: a.schemaStatus,
        schemaFetchedAt: a.schemaFetchedAt,
      })
      .from(a)
      .where(eq(a.appId, appId))
      .limit(1);
    return row;
  }

  /** Users (not deactivated) with their app stats + hub-game playtime (D2). */
  async memberRows(
    userIds: readonly number[],
    appId: number,
    gameId: number,
  ): Promise<MemberRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select(MEMBER_COLUMNS)
      .from(u)
      .leftJoin(s, and(eq(s.userId, u.id), eq(s.appId, appId)))
      .leftJoin(
        gi,
        and(
          eq(gi.userId, u.id),
          eq(gi.gameId, gameId),
          eq(gi.source, 'steam_library'),
        ),
      )
      .where(and(inArray(u.id, [...userIds]), isNull(u.deactivatedAt)));
    return rows.map(toMemberRow);
  }

  /** Api names `userId` has unlocked for `appId` (NULL-time rows included). */
  async unlockedApiNames(userId: number, appId: number): Promise<Set<string>> {
    const rows = await this.db
      .select({ apiName: ua.apiName })
      .from(ua)
      .where(and(eq(ua.userId, userId), eq(ua.appId, appId)));
    return new Set(rows.map((r) => r.apiName));
  }

  /** Newest unlocks by `userIds` with a real time (L2 decision 1). */
  async recentUnlocks(
    appId: number,
    userIds: readonly number[],
    limit: number,
  ): Promise<UnlockRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.unlockQuery(appId, userIds)
      .orderBy(desc(ua.unlockedAt), asc(ua.userId), asc(ach.apiName))
      .limit(limit);
    return rows.flatMap(toUnlockRow);
  }

  /** The rarest unlock (lowest global %) by `userIds`; first earner wins a tie. */
  async rarestUnlock(
    appId: number,
    userIds: readonly number[],
  ): Promise<UnlockRow | null> {
    if (userIds.length === 0) return null;
    const rows = await this.unlockQuery(appId, userIds, true)
      .orderBy(asc(ach.globalPct), asc(ua.unlockedAt), asc(ua.userId))
      .limit(1);
    return rows.flatMap(toUnlockRow)[0] ?? null;
  }

  private unlockQuery(
    appId: number,
    userIds: readonly number[],
    withPct = false,
  ) {
    return this.db
      .select(UNLOCK_COLUMNS)
      .from(ua)
      .innerJoin(ach, and(eq(ach.appId, ua.appId), eq(ach.apiName, ua.apiName)))
      .where(
        and(
          eq(ua.appId, appId),
          inArray(ua.userId, [...userIds]),
          isNotNull(ua.unlockedAt),
          withPct ? isNotNull(ach.globalPct) : undefined,
        ),
      )
      .$dynamic();
  }
}

function toMemberRow(r: {
  userId: number;
  username: string;
  displayName: string | null;
  customAvatarUrl: string | null;
  steamId: string | null;
  status: StoredMemberStats['status'] | null;
  unlockedCount: number | null;
  fetchedAt: Date | null;
  playtimeMinutes: number | null;
}): MemberRow {
  const { status, unlockedCount, fetchedAt, ...rest } = r;
  const stats =
    status !== null && fetchedAt !== null
      ? { status, unlockedCount, fetchedAt }
      : undefined;
  return { ...rest, stats };
}

function toUnlockRow(r: RawUnlock): UnlockRow[] {
  if (r.unlockedAt === null) return [];
  const { userId, unlockedAt, ...achievement } = r;
  return [{ userId, unlockedAt, achievement }];
}
