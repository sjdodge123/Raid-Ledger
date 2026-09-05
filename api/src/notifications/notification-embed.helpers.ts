/**
 * Discord notification embed helpers.
 * Extracted from discord-notification-embed.service.ts for file size compliance (ROK-711).
 */
import { absoluteEmbedImageUrl } from '../discord-bot/services/embed-thumbnail.helpers';
import { EmbedBuilder } from 'discord.js';
import type { EmbedState } from '../discord-bot/embeds/embed-chrome.helpers';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { applySubscribedGameEmbed } from './notification-embed.subscribed-game';

/** Safely convert an unknown payload value to a string. */
export function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}

/**
 * Notification type to lifecycle STATE (ROK-1477 §4, replaces
 * the deleted type→colour map). Colour is never chosen here — the state is
 * handed to `createDmEmbed`, and `colorForState` is the only map from a state
 * to a palette entry.
 *
 * The `Record` is EXHAUSTIVE on purpose: a new `NotificationType` becomes a
 * `tsc --noEmit` error instead of silently inheriting slate. Do not add a
 * `Partial<>` or a `??` fallback.
 */
export const NOTIFICATION_EMBED_STATES: Record<NotificationType, EmbedState> = {
  slot_vacated: 'announcing',
  event_reminder: 'needs_you',
  new_event: 'announcing',
  subscribed_game: 'announcing',
  // No lifecycle: a settled fact that asks nothing of the reader (A3).
  achievement_unlocked: 'done',
  level_up: 'done',
  missed_event_nudge: 'needs_you',
  event_rescheduled: 'needs_you',
  event_delayed: 'needs_you',
  running_late: 'needs_you',
  bench_promoted: 'live',
  event_cancelled: 'cancelled',
  roster_reassigned: 'done',
  tentative_displaced: 'done',
  member_returned: 'done',
  recruitment_reminder: 'announcing',
  role_gap_alert: 'needs_you',
  lineup_steam_nudge: 'announcing',
  community_lineup: 'announcing',
  user_deactivated_discord: 'done',
  user_reactivated_discord: 'done',
  post_event_followup: 'done',
  system: 'done',
};

/**
 * Resolve the embed state a notification type renders in.
 *
 * @param type - The notification type being rendered.
 * @returns The lifecycle state `createDmEmbed` should be given.
 */
export function notificationEmbedState(type: NotificationType): EmbedState {
  return NOTIFICATION_EMBED_STATES[type];
}

/**
 * Author lines for the standalone notification-DM builders, in the
 * `COMMAND_REPLY_AUTHORS` idiom (ROK-1462): glyph + SCREAMING STATE, no
 * markdown and no `<t:…>` — Discord renders neither in an author line.
 *
 * Proposed under ROK-1477 A9; the operator approves the copy at PR review.
 */
export const NOTIFICATION_DM_AUTHORS = {
  /** `post-event-reminder` "Thanks for joining!" — the event is over. */
  POST_EVENT_THANKS: '■ EVENT ENDED',
  /** `post-event-followup-prompt` "Schedule a follow-up?". */
  POST_EVENT_FOLLOWUP: '📅 FOLLOW-UP?',
  /** `recruitment-reminder` bump card — spots are still open. */
  RECRUITMENT_BUMP: '📢 SPOTS AVAILABLE',
  /** `departure-grace` slot-vacated card — asks the organiser to promote. */
  SLOT_VACATED: '◌ FILL NEEDED',
  /** `listeners/pug-invite` accept card — the reader is on the roster. */
  PUG_INVITE_ACCEPTED: '▸ SPOT CONFIRMED',
  /** `listeners/pug-invite` decline card. */
  PUG_INVITE_DECLINED: '✕ INVITE DECLINED',
  /** `departure-promote` fallback card when the original embed is missing. */
  DEPARTURE_PROMOTED: '■ ROSTER UPDATED',
} as const;

/** Get emoji for notification type. */
export function getEmojiForType(type: NotificationType): string {
  const map: Record<string, string> = {
    event_reminder: '⏰',
    new_event: '📅',
    subscribed_game: '🎮',
    slot_vacated: '🚪',
    member_returned: '🔙',
    bench_promoted: '🎉',
    roster_reassigned: '🔄',
    tentative_displaced: '⏳',
    event_rescheduled: '📆',
    event_delayed: '⏰',
    running_late: '🏃',
    event_cancelled: '❌',
    achievement_unlocked: '🏆',
    level_up: '⬆️',
    missed_event_nudge: '👋',
    recruitment_reminder: '📢',
    lineup_steam_nudge: '🔗',
    community_lineup: '🎯',
    role_gap_alert: '\u26A0\uFE0F',
  };
  return map[type] ?? '🔔';
}

/** Get human-readable label for notification type. */
export function getTypeLabel(type: NotificationType): string {
  const map: Record<string, string> = {
    event_reminder: 'Event Reminder',
    new_event: 'New Event',
    subscribed_game: 'Game Activity',
    slot_vacated: 'Slot Vacated',
    member_returned: 'Member Returned',
    bench_promoted: 'Bench Promoted',
    roster_reassigned: 'Roster Reassigned',
    tentative_displaced: 'Tentative Displaced',
    event_rescheduled: 'Event Rescheduled',
    event_delayed: 'Event Delayed',
    running_late: 'Running Late',
    event_cancelled: 'Event Cancelled',
    achievement_unlocked: 'Achievement',
    level_up: 'Level Up',
    missed_event_nudge: 'Missed Event',
    recruitment_reminder: 'Recruitment Reminder',
    lineup_steam_nudge: 'Steam Link Nudge',
    community_lineup: 'Community Lineup',
    role_gap_alert: 'Role Gap Alert',
  };
  return map[type] ?? 'Notification';
}

/** Add a field to an embed if the payload value is truthy. */
function addFieldIf(
  embed: EmbedBuilder,
  payload: Record<string, unknown>,
  key: string,
  name: string,
  inline = true,
): void {
  if (payload[key])
    embed.addFields({ name, value: toStr(payload[key]), inline });
}

/** Add a voice channel field if present. */
function addVoiceChannelField(
  embed: EmbedBuilder,
  payload: Record<string, unknown>,
): void {
  if (payload.voiceChannelId)
    embed.addFields({
      name: 'Voice Channel',
      value: `<#${toStr(payload.voiceChannelId)}>`,
      inline: true,
    });
}

/** Field definitions per notification type: [payloadKey, fieldName] pairs + voice flag. */
const TYPE_FIELD_DEFS: Partial<
  Record<NotificationType, { fields: [string, string][]; voice: boolean }>
> = {
  event_reminder: { fields: [['eventTitle', 'Event']], voice: true },
  new_event: { fields: [['gameName', 'Game']], voice: true },
  slot_vacated: { fields: [['slotName', 'Slot']], voice: true },
  member_returned: { fields: [['slotName', 'Slot']], voice: true },
  event_cancelled: { fields: [['eventTitle', 'Event']], voice: false },
  event_rescheduled: { fields: [], voice: true },
  bench_promoted: { fields: [], voice: true },
  tentative_displaced: { fields: [], voice: true },
  missed_event_nudge: { fields: [['eventTitle', 'Event']], voice: false },
  role_gap_alert: {
    fields: [
      ['eventTitle', 'Event'],
      ['gapSummary', 'Missing Roles'],
      ['rosterSummary', 'Roster'],
    ],
    voice: false,
  },
  recruitment_reminder: {
    fields: [
      ['eventTitle', 'Event'],
      ['signupSummary', 'Signups'],
      ['gameName', 'Game'],
    ],
    voice: true,
  },
  community_lineup: {
    fields: [['gameName', 'Game']],
    voice: false,
  },
};

/** Add type-specific fields to a notification embed. */
export function addTypeSpecificFields(
  embed: EmbedBuilder,
  type: NotificationType,
  payload?: Record<string, unknown>,
): void {
  if (!payload) return;
  if (type === 'subscribed_game') {
    applySubscribedGameEmbed(embed, payload);
    return;
  }
  const thumbnail =
    typeof payload.gameCoverUrl === 'string'
      ? absoluteEmbedImageUrl(payload.gameCoverUrl)
      : null;
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }
  if (type === 'roster_reassigned') {
    addRosterReassignedFields(embed, payload);
    return;
  }
  const def = TYPE_FIELD_DEFS[type];
  if (!def) return;
  for (const [key, name] of def.fields) addFieldIf(embed, payload, key, name);
  if (def.voice) addVoiceChannelField(embed, payload);
}

/** Handle roster_reassigned with conditional newRole field. */
function addRosterReassignedFields(
  embed: EmbedBuilder,
  payload: Record<string, unknown>,
): void {
  addFieldIf(embed, payload, 'oldRole', 'Previous Role');
  if (payload.newRole && payload.newRole !== 'player')
    addFieldIf(embed, payload, 'newRole', 'New Role');
  addVoiceChannelField(embed, payload);
}

export {
  buildExtraRows,
  buildPrimaryButton,
  buildInlineButtons,
} from './notification-embed.buttons';
