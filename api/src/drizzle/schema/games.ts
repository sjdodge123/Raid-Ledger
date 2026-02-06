import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';

/**
 * Games table - caches IGDB game data locally.
 * ROK-183: Added genres for MMO detection.
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
});
