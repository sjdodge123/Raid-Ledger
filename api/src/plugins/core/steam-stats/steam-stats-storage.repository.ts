import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  notInArray,
  sql,
  type Column,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { SteamStatsStatus } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type {
  SteamSchemaAchievement,
  SteamUnlockedAchievement,
} from '../../../steam/steam-achievements-http.util';
import { STEAM_STATS_APP_IDS } from './steam-stats.constants';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Writer = Db | Tx;

const apps = schema.steamAppStatsApps;
const ach = schema.steamAppAchievements;
const userStats = schema.steamUserAppStats;
const userAch = schema.steamUserAchievements;
const gi = schema.gameInterests;

/** Keep the first entry per key — one INSERT … ON CONFLICT may not touch a row twice. */
function uniqueBy<T>(rows: readonly T[], key: (r: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) if (!seen.has(key(r))) seen.set(key(r), r);
  return [...seen.values()];
}

/** `api_name NOT IN (...)`, or no filter when the kept set is empty. */
function notKept(col: Column, names: string[]): SQL | undefined {
  return names.length > 0 ? notInArray(col, names) : undefined;
}

/** Null `userId`'s `steam_library` playtime on the card games (Codex P2). */
async function clearCardPlaytime(tx: Writer, userId: number): Promise<void> {
  const cardGames = tx
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(inArray(schema.games.steamAppId, [...STEAM_STATS_APP_IDS]));
  await tx
    .update(gi)
    .set({ playtimeForever: null, playtime2weeks: null })
    .where(
      and(
        eq(gi.userId, userId),
        eq(gi.source, 'steam_library'),
        inArray(gi.gameId, cardGames),
      ),
    );
}

/** Upsert the app row; status follows the achievement count. */
async function upsertApp(
  tx: Writer,
  appId: number,
  count: number,
  now: Date,
): Promise<void> {
  const set = {
    achievementCount: count,
    schemaStatus: count > 0 ? ('ok' as const) : ('no_stats' as const),
    schemaFetchedAt: now,
  };
  await tx
    .insert(apps)
    .values({ appId, ...set })
    .onConflictDoUpdate({ target: apps.appId, set });
}

/** Insert rows for an app's schema achievements. */
function achievementValues(
  appId: number,
  rows: readonly SteamSchemaAchievement[],
  pct: ReadonlyMap<string, number> | null,
  now: Date,
): (typeof ach.$inferInsert)[] {
  return rows.map((a) => ({
    appId,
    apiName: a.apiName,
    name: a.name,
    description: a.description,
    iconUrl: a.icon,
    hidden: a.hidden,
    globalPct: pct?.get(a.apiName)?.toFixed(3) ?? null,
    updatedAt: now,
  }));
}

/** The conflict update; a failed % fetch (`pct` null) leaves `global_pct` alone. */
function achievementUpdate(
  pct: ReadonlyMap<string, number> | null,
  now: Date,
): PgUpdateSetSource<typeof ach> {
  return {
    name: sql`excluded.name`,
    description: sql`excluded.description`,
    iconUrl: sql`excluded.icon_url`,
    hidden: sql`excluded.hidden`,
    updatedAt: now,
    ...(pct === null ? {} : { globalPct: sql`excluded.global_pct` }),
  };
}

/** Upsert unlocks; a stored `unlocked_at` wins over Steam's (COALESCE). */
async function upsertUnlocks(
  tx: Writer,
  userId: number,
  appId: number,
  rows: readonly SteamUnlockedAchievement[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insert(userAch)
    .values(
      rows.map((r) => ({
        userId,
        appId,
        apiName: r.apiName,
        unlockedAt: r.unlockedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [userAch.userId, userAch.appId, userAch.apiName],
      set: {
        unlockedAt: sql`COALESCE(${userAch.unlockedAt}, excluded.unlocked_at)`,
      },
    });
}

/** The user and the Steam account a fetch was made for. */
export interface SteamStatsOwner {
  userId: number;
  steamId: string;
}

/**
 * True when `users.steam_id` still equals the fetched id. `FOR SHARE` holds
 * the row until commit, so an unlink/replace waits for this write and its
 * post-commit purge lands after it (no catch-and-retry: a plain read).
 */
async function stillOwns(tx: Tx, owner: SteamStatsOwner): Promise<boolean> {
  const [row] = await tx
    .select({ steamId: schema.users.steamId })
    .from(schema.users)
    .where(eq(schema.users.id, owner.userId))
    .for('share');
  return row?.steamId === owner.steamId;
}

/**
 * ROK-1953 §4.2 writes. Every write is one upsert on the table's primary key
 * (inputs de-duplicated first), so none can violate a unique key; nothing
 * catches and retries inside a transaction.
 */
@Injectable()
export class SteamStatsStorageRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /**
   * True when a good schema is stored (`achievement_count > 0`), even if the
   * latest fetch failed (`error`) — user unlocks refresh against it.
   */
  async hasUsableSchema(appId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ n: apps.achievementCount })
      .from(apps)
      .where(eq(apps.appId, appId));
    return (row?.n ?? 0) > 0;
  }

  /**
   * Schema fetch failed: record `error` only. The count, the achievement
   * rows and `schema_fetched_at` (the last SUCCESSFUL fetch) stay as they
   * were; the nightly run fetches the schema again every time.
   */
  async markSchemaError(appId: number): Promise<void> {
    await this.db
      .insert(apps)
      .values({ appId, schemaStatus: 'error', schemaFetchedAt: null })
      .onConflictDoUpdate({
        target: apps.appId,
        set: { schemaStatus: 'error' },
      });
  }

  /**
   * Replace an app's schema: upsert listed achievements, delete the ones
   * Steam no longer lists. `pct` null (the % fetch failed) keeps stored %.
   */
  async saveSchema(
    appId: number,
    list: readonly SteamSchemaAchievement[],
    pct: ReadonlyMap<string, number> | null,
    now: Date,
  ): Promise<void> {
    const rows = uniqueBy(list, (a) => a.apiName);
    await this.db.transaction(async (tx) => {
      await upsertApp(tx, appId, rows.length, now);
      if (rows.length > 0) {
        await tx
          .insert(ach)
          .values(achievementValues(appId, rows, pct, now))
          .onConflictDoUpdate({
            target: [ach.appId, ach.apiName],
            set: achievementUpdate(pct, now),
          });
      }
      const names = rows.map((r) => r.apiName);
      await tx
        .delete(ach)
        .where(and(eq(ach.appId, appId), notKept(ach.apiName, names)));
    });
  }

  /**
   * An `ok` fetch: replace the user's unlock set in one transaction. An
   * existing `unlocked_at` is kept; a vanished unlock is deleted. False (no
   * write) when the user's Steam account changed since the fetch.
   */
  async saveUserOk(
    owner: SteamStatsOwner,
    appId: number,
    unlocked: readonly SteamUnlockedAchievement[],
    now: Date,
  ): Promise<boolean> {
    const { userId } = owner;
    const rows = uniqueBy(unlocked, (u) => u.apiName);
    return this.db.transaction(async (tx) => {
      if (!(await stillOwns(tx, owner))) return false;
      const names = rows.map((r) => r.apiName);
      await tx
        .delete(userAch)
        .where(
          and(
            eq(userAch.userId, userId),
            eq(userAch.appId, appId),
            notKept(userAch.apiName, names),
          ),
        );
      await upsertUnlocks(tx, userId, appId, rows);
      await this.writeStatus(tx, userId, appId, 'ok', rows.length, now);
      return true;
    });
  }

  /**
   * The user's Steam account went away or was replaced (Codex P2): delete
   * every cached stats + unlock row so nothing from the old account is
   * served, counted or used to unmask. The next refresh rebuilds them.
   * The card games' `steam_library` playtime is nulled too: library sync
   * only rewrites games the new account owns, so A's hours would otherwise
   * read as B's forever. Scoped to {@link STEAM_STATS_APP_IDS} — other
   * features' library rows keep their pre-1953 unlink behaviour.
   */
  async purgeUser(userId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(userAch).where(eq(userAch.userId, userId));
      await tx.delete(userStats).where(eq(userStats.userId, userId));
      await clearCardPlaytime(tx, userId);
    });
  }

  /**
   * A non-`ok` fetch: status only (count null), unlock rows untouched. False
   * (no write) when the user's Steam account changed since the fetch.
   */
  async saveUserStatus(
    owner: SteamStatsOwner,
    appId: number,
    status: Exclude<SteamStatsStatus, 'ok'>,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (!(await stillOwns(tx, owner))) return false;
      await this.writeStatus(tx, owner.userId, appId, status, null, now);
      return true;
    });
  }

  private async writeStatus(
    w: Writer,
    userId: number,
    appId: number,
    status: SteamStatsStatus,
    unlockedCount: number | null,
    now: Date,
  ): Promise<void> {
    await w
      .insert(userStats)
      .values({ userId, appId, status, unlockedCount, fetchedAt: now })
      .onConflictDoUpdate({
        target: [userStats.userId, userStats.appId],
        set: { status, unlockedCount, fetchedAt: now },
      });
  }
}
