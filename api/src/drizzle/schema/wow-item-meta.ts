import {
  pgTable,
  integer,
  varchar,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * ROK-1727: global cache of Wowhead item metadata (name / quality / icon) for
 * WoW: Forever addon gear — plugin-owned (only `plugins/wow-common/wowhead-item`
 * writes it). One row per item holding the best env found (16 Forever first,
 * then 4 Classic); a re-probe upgrades 4 → 16 in place. No FK.
 */
export const wowItemMeta = pgTable(
  'wow_item_meta',
  {
    itemId: integer('item_id').primaryKey(),
    /** 'resolved' (env 16) | 'classic_fallback' (env 4) | 'not_found' | 'error'. */
    status: varchar('status', { length: 16 }).notNull(),
    /** Wowhead dataEnv the data came from: 16 / 4, null when unresolved. */
    env: smallint('env'),
    name: varchar('name', { length: 255 }),
    /** Wowhead quality id 0-7. */
    quality: smallint('quality'),
    /** Wowhead icon slug, validated `^[a-z0-9_]+$` before storing. */
    icon: varchar('icon', { length: 100 }),
    /** Last fetch attempt. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    /** When the row is due for a re-probe; null = never. */
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    /** Consecutive error count. */
    attempts: smallint('attempts').default(0).notNull(),
  },
  (table) => [index('idx_wow_item_meta_next_retry').on(table.nextRetryAt)],
);

export type WowItemMetaRow = typeof wowItemMeta.$inferSelect;
export type WowItemMetaInsert = typeof wowItemMeta.$inferInsert;
