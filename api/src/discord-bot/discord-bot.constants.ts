export const DISCORD_BOT_EVENTS = {
  CONNECTED: 'discord-bot.connected',
  DISCONNECTED: 'discord-bot.disconnected',
  ERROR: 'discord-bot.error',
} as const;

/**
 * Application-level event names for the event lifecycle.
 * Emitted by EventsService, consumed by DiscordEventListener.
 */
export const APP_EVENT_EVENTS = {
  CREATED: 'event.created',
  UPDATED: 'event.updated',
  CANCELLED: 'event.cancelled',
  DELETED: 'event.deleted',
} as const;

/**
 * Accent colors for Discord embeds (design spec section 2.1).
 * Values are decimal representations of hex colors for discord.js.
 */
export const EMBED_COLORS = {
  /** New Event / Announcement — Cyan #38bdf8 */
  ANNOUNCEMENT: 0x38bdf8,
  /** Reminder / Urgent — Amber #f59e0b */
  REMINDER: 0xf59e0b,
  /** Signup Confirmation — Emerald #34d399 */
  SIGNUP_CONFIRMATION: 0x34d399,
  /** Roster Update / Info — Purple #8b5cf6 */
  ROSTER_UPDATE: 0x8b5cf6,
  /** Ad-Hoc Live Event — Magenta #d946ef */
  LIVE_EVENT: 0xd946ef,
  /** PUG Invite — Teal #2dd4bf */
  PUG_INVITE: 0x2dd4bf,
  /** Error / Cancellation — Red #ef4444 */
  ERROR: 0xef4444,
  /** System / Admin — Slate #64748b */
  SYSTEM: 0x64748b,
} as const;

/**
 * Embed state values for the discord_event_messages table.
 * Tracks the embed lifecycle (design spec section 3.4).
 */
export const EMBED_STATES = {
  POSTED: 'posted',
  FILLING: 'filling',
  FULL: 'full',
  IMMINENT: 'imminent',
  LIVE: 'live',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type EmbedState = (typeof EMBED_STATES)[keyof typeof EMBED_STATES];

/**
 * Custom IDs for signup interaction buttons (ROK-137).
 * Format: `{action}:{eventId}` — e.g. `signup:42`
 */
export const SIGNUP_BUTTON_IDS = {
  SIGNUP: 'signup',
  TENTATIVE: 'tentative',
  DECLINE: 'decline',
  /** Role selection menu for anonymous participants */
  ROLE_SELECT: 'role_select',
  /** "Join & Sign Up" (deferred signup — Path A) */
  JOIN_SIGNUP: 'join_signup',
  /** "Quick Sign Up" (anonymous — Path B) */
  QUICK_SIGNUP: 'quick_signup',
} as const;

/**
 * Convert Discord.js errors into admin-friendly messages.
 * Shared between DiscordBotService and DiscordBotClientService to avoid
 * duplicating intent / token / network error detection.
 */
export function friendlyDiscordErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Failed to connect with provided token';
  const raw = error.message;

  if (
    /disallowed intent|privileged intent/i.test(raw) ||
    (error as Error & { code?: number })?.code === 4014
  ) {
    return 'Missing required privileged intent: Server Members. Enable it in the Discord Developer Portal under Bot > Privileged Gateway Intents.';
  }
  if (/invalid token|TOKEN_INVALID/i.test(raw)) {
    return 'Invalid bot token. Please check the token and try again.';
  }
  if (/getaddrinfo|ENOTFOUND/i.test(raw)) {
    return 'Unable to reach Discord servers. Check your internet connection.';
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return 'Connection to Discord was refused. Try again in a few moments.';
  }

  return 'Failed to connect with provided token';
}
