import { z } from 'zod';

// ============================================================
// Sign-in reminder settings (ROK-2284)
// ============================================================

/** Bounds shared by the admin form and the API (ruled Q2/Q5). */
export const SIGNIN_REMINDER_WEEKS_BOUNDS = { min: 1, max: 12 } as const;
export const SIGNIN_REMINDER_MAX_BOUNDS = { min: 1, max: 10 } as const;

/**
 * Admin settings for the bot's reminder DMs to guild members who have never
 * signed in. GET/PUT /admin/settings/signin-reminder. Defaults: on, every 3
 * weeks, at most 3 reminders.
 */
export const SigninReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  weeks: z
    .number()
    .int()
    .min(SIGNIN_REMINDER_WEEKS_BOUNDS.min)
    .max(SIGNIN_REMINDER_WEEKS_BOUNDS.max),
  max: z
    .number()
    .int()
    .min(SIGNIN_REMINDER_MAX_BOUNDS.min)
    .max(SIGNIN_REMINDER_MAX_BOUNDS.max),
});
export type SigninReminderSettingsDto = z.infer<
  typeof SigninReminderSettingsSchema
>;
