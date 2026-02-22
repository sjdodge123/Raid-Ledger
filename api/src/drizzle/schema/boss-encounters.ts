import {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  numeric,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * WoW Classic boss encounter data — plugin-owned table for wow-common.
 * Seeded from static JSON on plugin install, dropped on plugin uninstall.
 *
 * ROK-244: Variant-Aware Boss & Loot Table Seed Data
 */
export const wowClassicBosses = pgTable(
  'wow_classic_bosses',
  {
    id: serial('id').primaryKey(),
    /** Blizzard Journal instance ID (matches BlizzardService instance IDs) */
    instanceId: integer('instance_id').notNull(),
    /** Boss encounter name */
    name: varchar('name', { length: 255 }).notNull(),
    /** Boss ordering within the instance */
    order: integer('order').notNull(),
    /** Expansion: 'classic' | 'tbc' | 'wotlk' | 'cata' | 'sod' */
    expansion: varchar('expansion', { length: 20 }).notNull(),
    /** Whether this is a SoD-modified version of a Classic encounter */
    sodModified: boolean('sod_modified').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_boss_instance_name_expansion').on(
      table.instanceId,
      table.name,
      table.expansion,
    ),
  ],
);

/**
 * WoW Classic boss loot table data — plugin-owned table for wow-common.
 * Each row is one item that can drop from a boss encounter.
 *
 * ROK-244: Variant-Aware Boss & Loot Table Seed Data
 */
export const wowClassicBossLoot = pgTable(
  'wow_classic_boss_loot',
  {
    id: serial('id').primaryKey(),
    /** FK to wow_classic_bosses.id */
    bossId: integer('boss_id')
      .notNull()
      .references(() => wowClassicBosses.id, { onDelete: 'cascade' }),
    /** In-game item ID (Wowhead/IGDB reference) */
    itemId: integer('item_id').notNull(),
    /** Item display name */
    itemName: varchar('item_name', { length: 255 }).notNull(),
    /** Equipment slot (e.g., 'Head', 'Main Hand', 'Trinket') */
    slot: varchar('slot', { length: 50 }),
    /** Item quality: 'Poor' | 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' */
    quality: varchar('quality', { length: 20 }).notNull(),
    /** Item level */
    itemLevel: integer('item_level'),
    /** Drop rate as decimal (e.g., 0.15 for 15%) */
    dropRate: numeric('drop_rate', { precision: 5, scale: 4 }),
    /** Expansion this loot entry belongs to */
    expansion: varchar('expansion', { length: 20 }).notNull(),
    /** Class restrictions — null means all classes */
    classRestrictions: jsonb('class_restrictions').$type<string[]>(),
    /** Icon URL for the item */
    iconUrl: varchar('icon_url', { length: 512 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_loot_boss_item_expansion').on(
      table.bossId,
      table.itemId,
      table.expansion,
    ),
  ],
);

