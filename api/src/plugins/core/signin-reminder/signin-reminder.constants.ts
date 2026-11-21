/**
 * ROK-2284 — constants shared by the sign-in reminder cron, service, DM
 * builder and (layer 3) the "Don't remind me again" button listener.
 */

/** SchedulerRegistry name — matches the Core manifest + cron metadata. */
export const SIGNIN_REMINDER_JOB_NAME = 'SigninReminderCron_tick';

/**
 * Custom ids on the reminder DM. The listener must take the person from
 * `interaction.user.id`, never from the custom id (it carries no identity).
 */
export const SIGNIN_REMINDER_BUTTON_IDS = {
  STOP: 'signin_reminder:stop',
} as const;

/** Button label (ruled Q7). */
export const SIGNIN_REMINDER_STOP_LABEL = "Don't remind me again";

/** People who join after launch wait this long before a first DM (ruled Q3). */
export const SIGNIN_REMINDER_JOIN_WAIT_DAYS = 3;

/** Admin-setting defaults and bounds (ruled Q2/Q5). */
export const SIGNIN_REMINDER_DEFAULT_WEEKS = 3;
export const SIGNIN_REMINDER_DEFAULT_MAX = 3;
export const SIGNIN_REMINDER_WEEKS_RANGE = { min: 1, max: 12 } as const;
export const SIGNIN_REMINDER_MAX_RANGE = { min: 1, max: 10 } as const;
