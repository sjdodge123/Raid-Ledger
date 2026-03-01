import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { events } from './events';
import { users } from './users';

/**
 * Event Voice Sessions — tracks per-user voice channel presence during
 * scheduled events with voice channel bindings (ROK-490).
 *
 * Each row represents one user's cumulative voice presence for a single event.
 * Segments track individual join/leave intervals.
 * Classification is set after the event ends via cron.
 */
export const eventVoiceSessions = pgTable(
  'event_voice_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    /** RL user ID — nullable for unlinked Discord users */
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    discordUserId: varchar('discord_user_id', { length: 255 }).notNull(),
    discordUsername: varchar('discord_username', { length: 255 }).notNull(),
    firstJoinAt: timestamp('first_join_at').notNull(),
    lastLeaveAt: timestamp('last_leave_at'),
    totalDurationSec: integer('total_duration_sec').default(0).notNull(),
    /** Array of { joinAt, leaveAt, durationSec } segments */
    segments: jsonb('segments')
      .default([])
      .$type<
        Array<{ joinAt: string; leaveAt: string | null; durationSec: number }>
      >()
      .notNull(),
    /** Set after event ends: full, partial, late, early_leaver, no_show */
    classification: varchar('classification', { length: 20 }),
  },
  (table) => ({
    eventDiscordUserUnique: uniqueIndex(
      'event_voice_sessions_event_discord_user_unique',
    ).on(table.eventId, table.discordUserId),
    eventIdx: index('idx_event_voice_sessions_event').on(table.eventId),
  }),
);
