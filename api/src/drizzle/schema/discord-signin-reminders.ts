import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

/**
 * ROK-2284: one row per Discord guild member the sign-in reminder job has
 * looked at. Keyed by Discord id, not a user id — these people have no Raid
 * Ledger account yet. `sent_count` counts every attempt (a failed DM counts
 * too, so a closed DM is tried at most once per cadence and stops at the cap).
 * `claimed_at` is the per-tick claim (stale after 30 min, GG pattern).
 * `opted_out_at` is set by the "Don't remind me again" button and is never
 * cleared by the job.
 */
export const discordSigninReminders = pgTable('discord_signin_reminders', {
  discordId: text('discord_id').primaryKey(),
  sentCount: integer('sent_count').default(0).notNull(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  /** Discord API error code of the last failed DM (e.g. 50007), else null. */
  lastFailureCode: integer('last_failure_code'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type DiscordSigninReminderSelect =
  typeof discordSigninReminders.$inferSelect;
export type DiscordSigninReminderInsert =
  typeof discordSigninReminders.$inferInsert;
