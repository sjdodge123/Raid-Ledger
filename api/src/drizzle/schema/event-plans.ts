import {
  pgTable,
  uuid,
  integer,
  text,
  jsonb,
  smallint,
  timestamp,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';
import { events } from './events';

/**
 * Event plans table (ROK-392).
 * Tracks poll-based event scheduling lifecycle.
 * Each plan creates a Discord poll; when the poll closes,
 * the winning time is used to auto-create an event.
 */
export const eventPlans = pgTable(
  'event_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: integer('creator_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    description: text('description'),
    gameId: integer('game_id').references(() => games.id, {
      onDelete: 'set null',
    }),
    /** Per-event slot configuration (same shape as events.slotConfig). */
    slotConfig: jsonb('slot_config'),
    maxAttendees: integer('max_attendees'),
    autoUnbench: boolean('auto_unbench').default(true).notNull(),
    /** Duration in minutes for the auto-created event. */
    durationMinutes: integer('duration_minutes').notNull(),
    /** Array of candidate time options (date + label). */
    pollOptions: jsonb('poll_options')
      .notNull()
      .$type<Array<{ date: string; label: string }>>(),
    /** How long the poll runs (in hours). */
    pollDurationHours: smallint('poll_duration_hours').notNull(),
    /** Poll mode: 'standard' or 'all_or_nothing'. */
    pollMode: text('poll_mode').notNull().default('standard'),
    /** Current re-poll round (starts at 1). */
    pollRound: smallint('poll_round').notNull().default(1),
    /** Discord channel where the poll was posted. */
    pollChannelId: text('poll_channel_id'),
    /** Discord message ID of the current poll. */
    pollMessageId: text('poll_message_id'),
    /** Plan lifecycle status. */
    status: text('status').notNull().default('draft'),
    /** Index of the winning poll option (0-based). */
    winningOption: smallint('winning_option'),
    /** FK to the auto-created event (set when poll completes). */
    createdEventId: integer('created_event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    /** Content instances (e.g. selected dungeons/raids) for the auto-created event. */
    contentInstances: jsonb('content_instances'),
    /** Reminder settings for the auto-created event. */
    reminder15min: boolean('reminder_15min').default(true).notNull(),
    reminder1hour: boolean('reminder_1hour').default(false).notNull(),
    reminder24hour: boolean('reminder_24hour').default(false).notNull(),
    pollStartedAt: timestamp('poll_started_at'),
    pollEndsAt: timestamp('poll_ends_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_event_plans_creator_id').on(table.creatorId),
    index('idx_event_plans_status').on(table.status),
  ],
);
