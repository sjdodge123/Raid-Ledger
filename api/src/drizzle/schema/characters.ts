import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  unique,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { games } from './games';

/**
 * Characters - Player characters across different games.
 * Supports Main/Alt designation with enforced single main per game.
 * ROK-400: gameId now references games.id (integer) instead of game_registry.id (uuid).
 */
export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to users.id (integer) */
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** FK to games.id (integer) — ROK-400: was UUID referencing game_registry */
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    /** Character name */
    name: varchar('name', { length: 100 }).notNull(),
    /** Server/realm (e.g., WoW realm, FFXIV server) */
    realm: varchar('realm', { length: 100 }),
    /** Character class (e.g., 'Mage', 'Warrior') */
    class: varchar('class', { length: 50 }),
    /** Specialization (e.g., 'Arcane', 'Protection') */
    spec: varchar('spec', { length: 50 }),
    /** Role: 'tank', 'healer', 'dps' (synced from Blizzard) */
    role: varchar('role', { length: 20 }),
    /** User-set role override — takes priority over synced role */
    roleOverride: varchar('role_override', { length: 20 }),
    /** Is this the user's main character for this game? */
    isMain: boolean('is_main').default(false).notNull(),
    /** Item level / gear score */
    itemLevel: integer('item_level'),
    /** External API identifier (e.g., Blizzard character ID) */
    externalId: varchar('external_id', { length: 255 }),
    /** Character avatar URL */
    avatarUrl: text('avatar_url'),
    /** Full character render URL (Blizzard main-raw asset) */
    renderUrl: text('render_url'),
    /** Character level (e.g., from Blizzard Armory) */
    level: integer('level'),
    /** Character race (e.g., "Blood Elf") */
    race: varchar('race', { length: 50 }),
    /** Faction: "alliance" or "horde" */
    faction: varchar('faction', { length: 20 }),
    /** Last time character data was synced from external API */
    lastSyncedAt: timestamp('last_synced_at'),
    /** External profile URL (e.g., Blizzard Armory link) */
    profileUrl: text('profile_url'),
    /** Blizzard API region (us, eu, kr, tw) — persisted for auto-sync */
    region: varchar('region', { length: 10 }),
    /** WoW game variant (retail, classic_era, classic, classic_anniversary) */
    gameVariant: varchar('game_variant', { length: 30 }),
    /** Full equipped items data from Blizzard API (JSONB) */
    equipment: jsonb('equipment'),
    /** Raw talent tree data from Blizzard API (JSONB) */
    talents: jsonb('talents'),
    /** Display order for drag-to-reorder UI */
    displayOrder: integer('display_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    /** Prevent duplicate characters (same name+realm per user per game) */
    uniqueCharacter: unique('unique_user_game_character').on(
      table.userId,
      table.gameId,
      table.name,
      table.realm,
    ),
    /** Enforce single main per game per user (partial unique index) */
    oneMainPerGame: uniqueIndex('idx_one_main_per_game')
      .on(table.userId, table.gameId)
      .where(sql`${table.isMain} = true`),
    /** Index for efficient user character lookups */
    userIdIndex: index('idx_characters_user_id').on(table.userId),
    /** ROK-448: Composite index for avatar-by-name lookups in /auth/me */
    userIdNameIndex: index('idx_characters_user_id_name').on(
      table.userId,
      table.name,
    ),
  }),
);

/** Type inference for insert operations */
export type CharacterInsert = typeof characters.$inferInsert;

/** Type inference for select operations */
export type CharacterSelect = typeof characters.$inferSelect;
