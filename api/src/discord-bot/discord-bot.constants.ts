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
  /** ROK-1370: a reschedule poll opened against this event — flip the embed to
   *  RESCHEDULING and tear down the Discord Scheduled Event until lock-in. */
  RESCHEDULING: 'event.rescheduling',
} as const;

/**
 * Application-level event name for ad-hoc ("Quick Play") participant joins.
 * Emitted by AdHocParticipantService; consumed by LfgQuickPlayListener
 * (ROK-1451 AC7). Deliberately generic — no LFG concepts leak in here.
 */
export const AD_HOC_EVENTS = {
  PARTICIPANT_JOINED: 'ad-hoc.participant.joined',
} as const;

export interface AdHocParticipantJoinedPayload {
  eventId: number;
  /** RL user id, or null for an unlinked Discord participant. */
  userId: number | null;
  discordUserId?: string;
}

/**
 * Application-level event names for PUG slot lifecycle (ROK-292).
 * Emitted by PugsService, consumed by PugInviteListener.
 */
export const PUG_SLOT_EVENTS = {
  CREATED: 'pug-slot.created',
} as const;

/**
 * Accent colors for Discord embeds — one colour per lifecycle STATE, never per
 * content type (ROK-1459). Reach for `colorForState()` in
 * `discord-bot/embeds/embed-chrome.helpers.ts` rather than these keys directly.
 * Values are decimal representations of hex colors for discord.js.
 */
export const EMBED_COLORS = {
  /** announcing — something new exists. Cyan #38bdf8 */
  ANNOUNCEMENT: 0x38bdf8,
  /** needs-you — the reader must act. Amber #f59e0b */
  REMINDER: 0xf59e0b,
  /** live — it is happening / it is confirmed. Emerald #34d399 */
  SIGNUP_CONFIRMATION: 0x34d399,
  /** cancelled — it is off, or it failed. Red #ef4444 */
  ERROR: 0xef4444,
  /** done-context — settled state, admin and command replies. Slate #64748b */
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
  RESCHEDULING: 'rescheduling',
} as const;

export type EmbedState = (typeof EMBED_STATES)[keyof typeof EMBED_STATES];

/**
 * Application-level event names for signup lifecycle (ROK-119).
 * Emitted by SignupsService, consumed by DiscordSyncListener.
 */
export const SIGNUP_EVENTS = {
  CREATED: 'signup.created',
  UPDATED: 'signup.updated',
  DELETED: 'signup.deleted',
} as const;

export interface SignupEventPayload {
  eventId: number;
  userId?: number | null;
  signupId?: number;
  action: string;
}

/**
 * Custom IDs for signup interaction buttons (ROK-137).
 * Format: `{action}:{eventId}` — e.g. `signup:42`
 */
/**
 * Custom IDs for PUG invite interaction buttons (ROK-292).
 * Format: `{action}:{pugSlotId}` — e.g. `pug_accept:uuid`
 */
export const PUG_BUTTON_IDS = {
  ACCEPT: 'pug_accept',
  DECLINE: 'pug_decline',
  /** Select menus shown after PUG accepts — invitee picks character/role */
  CHARACTER_SELECT: 'pug_char_select',
  ROLE_SELECT: 'pug_role_select',
} as const;

/**
 * Custom IDs for member invite interaction buttons (ROK-292).
 * Format: `{action}:{eventId}:{notificationId}` — e.g. `member_accept:42:uuid`
 * Used for registered-user invites (as opposed to PUG invites).
 */
export const MEMBER_INVITE_BUTTON_IDS = {
  ACCEPT: 'member_accept',
  DECLINE: 'member_decline',
  CHARACTER_SELECT: 'member_char_select',
  ROLE_SELECT: 'member_role_select',
} as const;

/**
 * Application-level event names for member invite lifecycle (ROK-292).
 * Emitted by EventsService, consumed by PugInviteListener.
 */
export const MEMBER_INVITE_EVENTS = {
  CREATED: 'member.invite.created',
} as const;

export interface MemberInviteCreatedPayload {
  eventId: number;
  targetDiscordId: string;
  notificationId: string;
  /** Integer games.id for channel binding lookup */
  gameId?: number | null;
}

/**
 * Custom IDs for Roach Out interaction buttons on reminder DMs (ROK-378).
 * Format: `{action}:{eventId}` — e.g. `event_roachout:42`
 */
export const ROACH_OUT_BUTTON_IDS = {
  ROACH_OUT: 'event_roachout',
  CONFIRM: 'event_roachout_confirm',
  CANCEL: 'event_roachout_cancel',
} as const;

/**
 * Custom IDs for LFG interaction buttons (ROK-1454 D11).
 * Format: `{prefix}:{gameId}` — e.g. `lfg:withdraw:42`.
 *
 * `JOIN` was DECLARED BUT DELIBERATELY UNHANDLED in ROK-1454; ROK-1471 filled
 * the socket with `LfgJoinListener` (`listeners/lfg-join.listener.ts`), which
 * owns the `+1` button on the forum board. Reserving the id here is what stopped
 * the two stories inventing two different namespaces for the same button.
 */
export const LFG_BUTTON_IDS = {
  WITHDRAW: 'lfg:withdraw',
  /** Handled by `LfgJoinListener` (ROK-1471 D6); never by the withdraw path. */
  JOIN: 'lfg:join',
} as const;

/**
 * Custom IDs for "Running Late" interaction buttons on reminder DMs (ROK-1379).
 * Attendee marker: `event_late:{eventId}` / `event_late_here:{eventId}`.
 * Host delay flow: `event_late_delay:{eventId}:{minutes}` / `event_late_delay_cancel:{eventId}`.
 */
export const RUNNING_LATE_BUTTON_IDS = {
  LATE: 'event_late',
  HERE: 'event_late_here',
  DELAY: 'event_late_delay',
  DELAY_CANCEL: 'event_late_delay_cancel',
} as const;

/**
 * Custom IDs for departure promote/dismiss interaction buttons (ROK-596).
 * Format: `{action}:{eventId}:{role}:{position}` — e.g. `depart_promote:42:tank:1`
 */
export const DEPARTURE_PROMOTE_BUTTON_IDS = {
  PROMOTE: 'depart_promote',
  DISMISS: 'depart_dismiss',
} as const;

/**
 * Custom IDs for reschedule DM confirm/decline interaction buttons (ROK-537).
 * Format: `{action}:{eventId}` — e.g. `reschedule_confirm:42`
 */
export const RESCHEDULE_BUTTON_IDS = {
  CONFIRM: 'reschedule_confirm',
  TENTATIVE: 'reschedule_tentative',
  DECLINE: 'reschedule_decline',
  CHARACTER_SELECT: 'reschedule_char_select',
  ROLE_SELECT: 'reschedule_role_select',
} as const;

/** Custom IDs for /bind multi-monitor confirmation buttons (ROK-959). */
export const BIND_CONFIRM_BUTTON_IDS = {
  CONTINUE: 'bind_confirm_continue',
  CANCEL: 'bind_confirm_cancel',
} as const;

/**
 * Custom IDs for Steam URL interest prompt buttons (ROK-966).
 * Format: `{action}:{gameId}` -- e.g. `steam_interest_heart:42`
 */
export const STEAM_INTEREST_BUTTON_IDS = {
  HEART: 'steam_interest_heart',
  DISMISS: 'steam_interest_dismiss',
  AUTO: 'steam_interest_auto',
} as const;

/**
 * Custom IDs for Steam URL paste-to-nominate buttons (ROK-1081).
 * Format: `{action}:{gameId}` -- e.g. `steam_nominate_nominate:42`.
 * The active lineup is re-resolved on click so nothing is stale.
 */
export const STEAM_NOMINATE_BUTTON_IDS = {
  NOMINATE: 'steam_nominate_nominate',
  HEART: 'steam_nominate_heart',
  AUTO: 'steam_nominate_auto',
  DISMISS: 'steam_nominate_dismiss',
} as const;

/**
 * Custom IDs for the post-event follow-up prompt DM buttons (ROK-1371).
 * Format: `{action}:{endedEventId}` — e.g. `pef_schedule:42`.
 * [Schedule event] replies with a deep-link; [Start a poll] opens a StandalonePoll.
 */
export const POST_EVENT_FOLLOWUP_BUTTON_IDS = {
  SCHEDULE: 'pef_schedule',
  POLL: 'pef_poll',
} as const;

export const SIGNUP_BUTTON_IDS = {
  SIGNUP: 'signup',
  TENTATIVE: 'tentative',
  DECLINE: 'decline',
  /** Role selection menu for anonymous participants */
  ROLE_SELECT: 'role_select',
  /** Character selection menu for linked users (ROK-138) */
  CHARACTER_SELECT: 'char_select',
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
