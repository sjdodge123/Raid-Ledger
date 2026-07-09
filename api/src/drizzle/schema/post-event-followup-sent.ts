import {
  pgTable,
  serial,
  integer,
  timestamp,
  varchar,
  unique,
} from 'drizzle-orm/pg-core';
import { events } from './events';

/**
 * Post-event follow-up dedup / single-fire table (ROK-1371). Keyed by
 * `event_id` only — exactly one prompt per ended event.
 *
 * Three sentinels, each owning a distinct guard:
 * - `prompt_sent_at`   — M2 organizer-prompt dedup (`ON CONFLICT (event_id)
 *   DO NOTHING` on the prompt insert stops the 60 s re-DM).
 * - `choice`           — POLL path only. Stamped atomically on `[Start a poll]`
 *   click to block a double-click opening two polls. The event path never
 *   writes this (its button creates nothing — it deep-links).
 * - `attendees_notified_at` — universal exactly-once fan-out claim across BOTH
 *   paths. Atomically set to `now()` before the attendee DMs go out; a second
 *   attempt finds it non-null and no-ops.
 */
export const postEventFollowupSent = pgTable(
  'post_event_followup_sent',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    /** Organizer prompt sent (M2 dedup sentinel — stops the 60 s re-DM). */
    promptSentAt: timestamp('prompt_sent_at').defaultNow().notNull(),
    /** POLL path single-fire guard. null = no poll opened. 'poll' once opened. */
    choice: varchar('choice', { length: 20 }),
    /** Universal exactly-once fan-out claim (BOTH paths). null = not fanned out. */
    attendeesNotifiedAt: timestamp('attendees_notified_at'),
  },
  (table) => [unique('unique_post_event_followup').on(table.eventId)],
);

export type PostEventFollowupSent = typeof postEventFollowupSent.$inferSelect;
export type NewPostEventFollowupSent =
  typeof postEventFollowupSent.$inferInsert;
