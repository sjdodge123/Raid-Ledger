import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  boolean,
  varchar,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Games table - unified game data (IGDB metadata + community config).
 * ROK-400: Merged game_registry config columns into this table.
 * Non-IGDB games (e.g., "Generic") use igdbId: null.
 */
export const games = pgTable('games', {
  id: serial('id').primaryKey(),
  igdbId: integer('igdb_id').unique(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  coverUrl: text('cover_url'),
  /** ROK-183: Array of IGDB genre IDs (e.g., [12, 31] for Role-playing + Adventure) */
  genres: jsonb('genres').$type<number[]>().default([]),
  cachedAt: timestamp('cached_at').defaultNow().notNull(),

  // ROK-229: Expanded fields for game discovery
  summary: text('summary'),
  rating: real('rating'),
  aggregatedRating: real('aggregated_rating'),
  popularity: real('popularity'),
  /** IGDB game mode IDs: 1=single, 2=multi, 3=coop, 5=MMO */
  gameModes: jsonb('game_modes').$type<number[]>().default([]),
  themes: jsonb('themes').$type<number[]>().default([]),
  platforms: jsonb('platforms').$type<number[]>().default([]),
  screenshots: jsonb('screenshots').$type<string[]>().default([]),
  videos: jsonb('videos')
    .$type<{ name: string; videoId: string }[]>()
    .default([]),
  firstReleaseDate: timestamp('first_release_date'),
  playerCount: jsonb('player_count').$type<{
    min: number;
    max: number;
  } | null>(),
  /** Twitch category ID for streams lookup (may differ from IGDB ID) */
  twitchGameId: text('twitch_game_id'),
  /** Whether the game supports cross-platform play (inferred from IGDB or manual) */
  crossplay: boolean('crossplay'),
  /** ROK-231: Hidden games are excluded from user-facing search/discovery */
  hidden: boolean('hidden').notNull().default(false),
  /** ROK-231: Banned games are tombstoned — excluded from sync, search, and discovery */
  banned: boolean('banned').notNull().default(false),

  // ROK-400: Config columns (formerly in game_registry)
  /** Abbreviated display name for compact UI contexts (breadcrumbs, chips) */
  shortName: varchar('short_name', { length: 30 }),
  /** Hex color for UI theming */
  colorHex: varchar('color_hex', { length: 7 }),
  /** Whether this game has role-based composition (Tank/Healer/DPS) */
  hasRoles: boolean('has_roles').default(false).notNull(),
  /** Whether this game has specializations/specs */
  hasSpecs: boolean('has_specs').default(false).notNull(),
  /** Whether this game is enabled for event/character creation */
  enabled: boolean('enabled').default(true).notNull(),
  /** Maximum characters a user can register per game */
  maxCharactersPerUser: integer('max_characters_per_user')
    .default(10)
    .notNull(),
});

/**
 * Event Types - Game-specific event type templates.
 * ROK-400: FK now references games.id (integer) instead of game_registry.id (uuid).
 * @example WoW -> Mythic Raid (20 players), Heroic Raid (30 players)
 */
export const eventTypes = pgTable(
  'event_types',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
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
