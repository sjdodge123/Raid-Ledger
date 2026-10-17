import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { games } from './games';

/**
 * Discord Game Mappings — admin-managed overrides that map Discord
 * activity names to games in the system (ROK-442).
 *
 * When a Discord presence update reports "FINAL FANTASY XIV" but the
 * game is stored as "Final Fantasy XIV Online", an admin can create
 * a mapping to resolve the mismatch.
 */
export const discordGameMappings = pgTable('discord_game_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  discordActivityName: text('discord_activity_name').unique().notNull(),
  gameId: integer('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
