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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { gameRegistry } from './game-registry';

/**
 * Characters - Player characters across different games.
 * Supports Main/Alt designation with enforced single main per game.
 */
export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to users.id (integer) */
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** FK to game_registry.id (uuid) */
    gameId: uuid('game_id')
      .references(() => gameRegistry.id, { onDelete: 'cascade' })
      .notNull(),
    /** Character name */
    name: varchar('name', { length: 100 }).notNull(),
    /** Server/realm (e.g., WoW realm, FFXIV server) */
    realm: varchar('realm', { length: 100 }),
    /** Character class (e.g., 'Mage', 'Warrior') */
    class: varchar('class', { length: 50 }),
    /** Specialization (e.g., 'Arcane', 'Protection') */
    spec: varchar('spec', { length: 50 }),
    /** Role: 'tank', 'healer', 'dps' */
    role: varchar('role', { length: 20 }),
    /** Is this the user's main character for this game? */
    isMain: boolean('is_main').default(false).notNull(),
    /** Item level / gear score */
    itemLevel: integer('item_level'),
    /** External API identifier (e.g., Blizzard character ID) */
    externalId: varchar('external_id', { length: 255 }),
    /** Character avatar URL */
    avatarUrl: text('avatar_url'),
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
  }),
);

/** Type inference for insert operations */
export type CharacterInsert = typeof characters.$inferInsert;

/** Type inference for select operations */
export type CharacterSelect = typeof characters.$inferSelect;
