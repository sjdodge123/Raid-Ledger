import { z } from 'zod';

/**
 * ROK-1435 — weekly Discord digest admin settings.
 *
 * The digest cron ticks hourly and posts once a week, on `day` from `hour`
 * onward in the community timezone (later ticks that day retry a skipped
 * slot). `channelId: null` means "no dedicated channel" — the
 * digest then posts to the bot's default notification channel.
 */

/** Day of week the digest posts on: 0 (Sunday) – 6 (Saturday). */
export const WeeklyDigestDaySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export type WeeklyDigestDay = z.infer<typeof WeeklyDigestDaySchema>;

/** Body of `PUT /admin/settings/discord-bot/weekly-digest` (full replace). */
export const WeeklyDigestSettingsSchema = z.object({
  enabled: z.boolean(),
  /** A Discord channel snowflake (17–20 digits), or null for the default. */
  channelId: z
    .string()
    .trim()
    .regex(/^\d{17,20}$/, 'channelId must be a Discord channel id')
    .nullable(),
  day: WeeklyDigestDaySchema,
  hour: z.number().int().min(0).max(23),
});

/**
 * GET/PUT response. `timezone` is the community timezone the day + hour are
 * read in (UTC when none is configured) — shown next to the hour picker.
 */
export const WeeklyDigestSettingsResponseSchema =
  WeeklyDigestSettingsSchema.extend({
    timezone: z.string(),
  });

export type WeeklyDigestSettings = z.infer<typeof WeeklyDigestSettingsSchema>;
export type WeeklyDigestSettingsResponse = z.infer<
  typeof WeeklyDigestSettingsResponseSchema
>;
