import { pgTable, uuid, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Per-series ephemeral-voice opt-in (ROK-1352).
 *
 * Keyed by the recurrence group that links a series of event instances
 * (`events.recurrence_group_id`). When `ephemeralVoiceEnabled` is true, every
 * event in the series gets an ephemeral voice channel (subject to the global
 * master toggle + per-event override). Absent row = series not opted in.
 */
export const eventSeriesSettings = pgTable('event_series_settings', {
  recurrenceGroupId: uuid('recurrence_group_id').primaryKey(),
  ephemeralVoiceEnabled: boolean('ephemeral_voice_enabled')
    .default(false)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
