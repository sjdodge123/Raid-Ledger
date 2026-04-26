export const DISCORD_NOTIFICATION_QUEUE = 'discord-notification';

/**
 * Job data for Discord notification delivery.
 */
export interface DiscordNotificationJobData {
  notificationId: string;
  userId: number;
  discordId: string;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

/**
 * Rate limiting: max 1 DM per notification type per 5-minute window per user.
 */
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Number of consecutive failures before auto-disabling Discord for a user.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Discord snowflakes are 17–19 digit numeric strings. Local-auth users
 * are seeded with a `local:<email>` placeholder in the `discord_id`
 * column; sending those to Discord causes the queue to retry forever
 * on `Invalid Form Body / NUMBER_TYPE_COERCE`.
 */
export function isDiscordSnowflake(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^\d{17,19}$/.test(id);
}
