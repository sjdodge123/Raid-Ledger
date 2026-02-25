import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { events } from './events';
import { users } from './users';

/**
 * Ad-Hoc Participants — tracks Discord voice channel members who participated
 * in an ad-hoc event session (ROK-293).
 *
 * Users with linked RL accounts have userId populated.
 * Unlinked Discord users are tracked as anonymous participants via discordUserId.
 */
export const adHocParticipants = pgTable(
  'ad_hoc_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    /** RL user ID — nullable for anonymous/unlinked Discord users */
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    discordUserId: varchar('discord_user_id', { length: 255 }).notNull(),
    discordUsername: varchar('discord_username', { length: 255 }).notNull(),
    discordAvatarHash: varchar('discord_avatar_hash', { length: 255 }),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
    /** Total seconds spent in the voice channel across all sessions */
    totalDurationSeconds: integer('total_duration_seconds'),
    /** Number of join/leave cycles in this event */
    sessionCount: integer('session_count').default(1).notNull(),
  },
  (table) => ({
    eventDiscordUserUnique: uniqueIndex(
      'ad_hoc_participants_event_discord_user_unique',
    ).on(table.eventId, table.discordUserId),
    eventIdx: index('idx_ad_hoc_participants_event').on(table.eventId),
    userIdx: index('idx_ad_hoc_participants_user').on(table.userId),
  }),
);
