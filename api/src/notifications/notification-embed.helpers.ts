/**
 * Discord notification embed helpers.
 * Extracted from discord-notification-embed.service.ts for file size compliance (ROK-711).
 */
import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { applySubscribedGameEmbed } from './notification-embed.subscribed-game';

/** Safely convert an unknown payload value to a string. */
export function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}

/** Get embed color for notification type. */
export function getColorForType(type: NotificationType): number {
  const map: Partial<Record<NotificationType, number>> = {
    event_reminder: EMBED_COLORS.REMINDER,
    new_event: EMBED_COLORS.ANNOUNCEMENT,
    subscribed_game: EMBED_COLORS.ANNOUNCEMENT,
    event_rescheduled: EMBED_COLORS.REMINDER,
    event_cancelled: EMBED_COLORS.ERROR,
    achievement_unlocked: EMBED_COLORS.SIGNUP_CONFIRMATION,
    level_up: EMBED_COLORS.SIGNUP_CONFIRMATION,
    missed_event_nudge: EMBED_COLORS.REMINDER,
    role_gap_alert: EMBED_COLORS.REMINDER,
    recruitment_reminder: EMBED_COLORS.ANNOUNCEMENT,
    lineup_steam_nudge: EMBED_COLORS.ANNOUNCEMENT,
    community_lineup: EMBED_COLORS.ANNOUNCEMENT,
    slot_vacated: EMBED_COLORS.ROSTER_UPDATE,
    member_returned: EMBED_COLORS.ROSTER_UPDATE,
    bench_promoted: EMBED_COLORS.ROSTER_UPDATE,
    roster_reassigned: EMBED_COLORS.ROSTER_UPDATE,
    tentative_displaced: EMBED_COLORS.ROSTER_UPDATE,
  };
  return map[type] ?? EMBED_COLORS.SYSTEM;
}

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
