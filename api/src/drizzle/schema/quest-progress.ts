import {
  pgTable,
  serial,
  integer,
  boolean,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { events } from './events';

/**
 * WoW Classic quest progress tracking — per-event, per-player.
 * Tracks whether a player has picked up or completed a quest for a specific event.
 * Sharable quest coverage is derived from querying all progress entries for an event.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 */
export const wowClassicQuestProgress = pgTable(
  'wow_classic_quest_progress',
  {
    id: serial('id').primaryKey(),
    /** FK to events.id */
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    /** FK to users.id */
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Quest ID from dungeon quests (not a FK — quest data may be re-seeded) */
    questId: integer('quest_id').notNull(),
    /** Whether the player has picked up this quest */
    pickedUp: boolean('picked_up').default(false).notNull(),
    /** Whether the player has completed this quest */
    completed: boolean('completed').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_quest_progress_event_user_quest').on(
      table.eventId,
      table.userId,
      table.questId,
    ),
  ],
);
