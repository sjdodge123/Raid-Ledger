import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SteamStatsStatus } from '@raid-ledger/contract';
import { users } from './users';

const tsz = (name: string) => timestamp(name, { withTimezone: true });

/** Per-app schema state — `no_stats` = Steam lists no achievements for it. */
export type SteamAppSchemaStatus = 'ok' | 'no_stats' | 'error';

/**
 * ROK-1953 §4.2: one row per Steam app the nightly refresh has looked at.
 * Keyed by app id only — no FK to `games` (two game rows may share an id).
 */
export const steamAppStatsApps = pgTable(
  'steam_app_stats_apps',
  {
    appId: integer('app_id').primaryKey(),
    achievementCount: integer('achievement_count').notNull().default(0),
    schemaStatus: varchar('schema_status', { length: 10 })
      .$type<SteamAppSchemaStatus>()
      .notNull(),
    schemaFetchedAt: tsz('schema_fetched_at'),
  },
  (t) => [
    check(
      'steam_app_stats_apps_schema_status_check',
      sql`${t.schemaStatus} IN ('ok', 'no_stats', 'error')`,
    ),
  ],
);

/** ROK-1953: Steam's achievement schema + global unlock %, per app. */
export const steamAppAchievements = pgTable(
  'steam_app_achievements',
  {
    appId: integer('app_id')
      .notNull()
      .references(() => steamAppStatsApps.appId, { onDelete: 'cascade' }),
    apiName: varchar('api_name', { length: 128 }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Stored, not served in v1 (text-only cards). */
    iconUrl: text('icon_url'),
    hidden: boolean('hidden').notNull().default(false),
    /** 0–100, null when Steam has no figure for it. */
    globalPct: numeric('global_pct', { precision: 6, scale: 3 }),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.apiName] })],
);

/** ROK-1953: the last fetch outcome for one (user, app). */
export const steamUserAppStats = pgTable(
  'steam_user_app_stats',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    appId: integer('app_id').notNull(),
    status: varchar('status', { length: 10 })
      .$type<SteamStatsStatus>()
      .notNull(),
    /** Null unless the last fetch was `ok`. */
    unlockedCount: integer('unlocked_count'),
    fetchedAt: tsz('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.appId] }),
    index('steam_user_app_stats_app_fetched_idx').on(t.appId, t.fetchedAt),
    check(
      'steam_user_app_stats_status_check',
      sql`${t.status} IN ('ok', 'private', 'not_owned', 'pending', 'unlinked', 'error')`,
    ),
  ],
);

/**
 * ROK-1953: a user's unlocked achievements. No FK to
 * `steam_app_achievements` — a Steam schema change must not delete history.
 * `unlocked_at` is NULL when Steam reports `unlocktime: 0` on an achieved
 * entry (very old unlocks; L1 decision 3) — the row still counts for masking
 * but is left out of the recent-unlocks feed.
 */
export const steamUserAchievements = pgTable(
  'steam_user_achievements',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    appId: integer('app_id').notNull(),
    apiName: varchar('api_name', { length: 128 }).notNull(),
    unlockedAt: tsz('unlocked_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.appId, t.apiName] }),
    index('steam_user_achievements_app_unlocked_idx').on(
      t.appId,
      t.unlockedAt.desc().nullsLast(),
    ),
  ],
);
