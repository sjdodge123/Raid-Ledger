import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-1786 (S2 of ROK-1781): addons a guild's editors recommend to members.
 * Plugin-owned. `source` is curseforge | wago | github | url; `slug_or_url`
 * is the parsed slug (`owner/repo` for GitHub) or the normalised URL.
 * Community-wide pinned entries live in the `guild_pinned_addons` setting.
 * `cached_meta` (CurseForge enrichment) is deferred to S7.
 */
export const guildRecommendedAddons = pgTable(
  'guild_recommended_addons',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    source: varchar('source', { length: 20 }).notNull(),
    slugOrUrl: varchar('slug_or_url', { length: 500 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    note: varchar('note', { length: 500 }),
    /** required | optional */
    requirement: varchar('requirement', { length: 10 })
      .default('optional')
      .notNull(),
    /** retail | classic | forever; null = every flavor. */
    flavor: varchar('flavor', { length: 30 }),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdByUserId: integer('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'guild_recommended_addons_source',
      sql`${table.source} IN ('curseforge', 'wago', 'github', 'url')`,
    ),
    check(
      'guild_recommended_addons_requirement',
      sql`${table.requirement} IN ('required', 'optional')`,
    ),
    // Also backs the guild_id FK (ROK-1157: leading column, not partial).
    uniqueIndex('idx_guild_recommended_addons_guild_source_slug').on(
      table.guildId,
      table.source,
      table.slugOrUrl,
    ),
    index('idx_guild_recommended_addons_guild_sort').on(
      table.guildId,
      table.sortOrder,
    ),
    index('idx_guild_recommended_addons_created_by').on(table.createdByUserId),
    index('idx_guild_recommended_addons_updated_by').on(table.updatedByUserId),
  ],
);

export type GuildRecommendedAddonInsert =
  typeof guildRecommendedAddons.$inferInsert;
export type GuildRecommendedAddonSelect =
  typeof guildRecommendedAddons.$inferSelect;
