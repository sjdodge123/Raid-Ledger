import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Games table - caches IGDB game data locally.
 * ROK-183: Added genres for MMO detection.
 * ROK-229: Expanded with full IGDB metadata for discovery page.
 */
export const games = pgTable('games', {
  id: serial('id').primaryKey(),
  igdbId: integer('igdb_id').unique().notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
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
});
