import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const games = pgTable('games', {
  id: serial('id').primaryKey(),
  igdbId: integer('igdb_id').unique().notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  coverUrl: text('cover_url'),
  cachedAt: timestamp('cached_at').defaultNow().notNull(),
});
