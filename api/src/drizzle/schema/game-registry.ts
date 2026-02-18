import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Game Registry - Defines supported games with their configuration.
 * This is separate from the IGDB games cache which stores external game data.
 */
export const gameRegistry = pgTable('game_registry', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 50 }).unique().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  /** Abbreviated display name for compact UI contexts (breadcrumbs, chips) */
  shortName: varchar('short_name', { length: 30 }),
  iconUrl: text('icon_url'),
  colorHex: varchar('color_hex', { length: 7 }),
  /** Whether this game has role-based composition (Tank/Healer/DPS) */
  hasRoles: boolean('has_roles').default(false).notNull(),
  /** Whether this game has specializations/specs */
  hasSpecs: boolean('has_specs').default(false).notNull(),
  /** Whether this game is enabled for event/character creation (ROK-204) */
  enabled: boolean('enabled').default(true).notNull(),
  /** Maximum characters a user can register per game */
  maxCharactersPerUser: integer('max_characters_per_user')
    .default(10)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Event Types - Game-specific event type templates.
 * @example WoW → Mythic Raid (20 players), Heroic Raid (30 players)
 */
export const eventTypes = pgTable(
  'event_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .references(() => gameRegistry.id, { onDelete: 'cascade' })
      .notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    /** Default player cap for this event type (null = unlimited) */
    defaultPlayerCap: integer('default_player_cap'),
    /** Default event duration in minutes */
    defaultDurationMinutes: integer('default_duration_minutes'),
    /** Whether this event type requires role composition (Tank/Healer/DPS) */
    requiresComposition: boolean('requires_composition')
      .default(false)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    gameSlugUnique: unique('event_types_game_slug_unique').on(
      table.gameId,
      table.slug,
    ),
  }),
);
