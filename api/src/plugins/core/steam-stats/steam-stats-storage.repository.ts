import { Inject, Injectable } from '@nestjs/common';
import { and, eq, notInArray, sql, type Column, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { SteamStatsStatus } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type {
  SteamSchemaAchievement,
  SteamUnlockedAchievement,
} from '../../../steam/steam-achievements-http.util';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Writer = Db | Tx;

const apps = schema.steamAppStatsApps;
const ach = schema.steamAppAchievements;
const userStats = schema.steamUserAppStats;
const userAch = schema.steamUserAchievements;

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

/**
 * ROK-1953 §4.2 writes. Every write is one upsert on the table's primary key
 * (inputs de-duplicated first), so none can violate a unique key; nothing
 * catches and retries inside a transaction.
 */
@Injectable()
export class SteamStatsStorageRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The stored schema status of an app, or null if never fetched. */
  async schemaStatus(appId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ s: apps.schemaStatus })
      .from(apps)
      .where(eq(apps.appId, appId));
    return row?.s ?? null;
  }

  /** Schema fetch failed: mark `error`, keep the old achievement rows. */
  async markSchemaError(appId: number, now: Date): Promise<void> {
    await this.db
      .insert(apps)
      .values({ appId, schemaStatus: 'error', schemaFetchedAt: now })
      .onConflictDoUpdate({
        target: apps.appId,
        set: { schemaStatus: 'error', schemaFetchedAt: now },
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
   * existing `unlocked_at` is kept; a vanished unlock is deleted.
   */
  async saveUserOk(
    userId: number,
    appId: number,
    unlocked: readonly SteamUnlockedAchievement[],
    now: Date,
  ): Promise<void> {
    const rows = uniqueBy(unlocked, (u) => u.apiName);
    await this.db.transaction(async (tx) => {
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
    });
  }

  /** A non-`ok` fetch: status only (count null), unlock rows untouched. */
  async saveUserStatus(
    userId: number,
    appId: number,
    status: Exclude<SteamStatsStatus, 'ok'>,
    now: Date,
  ): Promise<void> {
    await this.writeStatus(this.db, userId, appId, status, null, now);
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
