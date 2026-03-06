/**
 * Discord notification embed helpers.
 * Extracted from discord-notification-embed.service.ts for file size compliance (ROK-711).
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { EMBED_COLORS, RESCHEDULE_BUTTON_IDS, ROACH_OUT_BUTTON_IDS, SIGNUP_BUTTON_IDS } from '../discord-bot/discord-bot.constants';
import type { NotificationType } from '../drizzle/schema/notification-preferences';

/** Safely convert an unknown payload value to a string. */
export function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  return '';
}

/** Get embed color for notification type. */
export function getColorForType(type: NotificationType): number {
  const map: Partial<Record<NotificationType, number>> = {
    event_reminder: EMBED_COLORS.REMINDER, new_event: EMBED_COLORS.ANNOUNCEMENT,
    subscribed_game: EMBED_COLORS.ANNOUNCEMENT, event_rescheduled: EMBED_COLORS.REMINDER,
    event_cancelled: EMBED_COLORS.ERROR, achievement_unlocked: EMBED_COLORS.SIGNUP_CONFIRMATION,
    level_up: EMBED_COLORS.SIGNUP_CONFIRMATION, missed_event_nudge: EMBED_COLORS.REMINDER,
    role_gap_alert: EMBED_COLORS.REMINDER, recruitment_reminder: EMBED_COLORS.ANNOUNCEMENT,
  };
  const rosterTypes: NotificationType[] = ['slot_vacated', 'member_returned', 'bench_promoted', 'roster_reassigned', 'tentative_displaced'];
  if (rosterTypes.includes(type)) return EMBED_COLORS.ROSTER_UPDATE;
  return map[type] ?? EMBED_COLORS.SYSTEM;
}

/** Get emoji for notification type. */
export function getEmojiForType(type: NotificationType): string {
  const map: Record<string, string> = {
    event_reminder: '⏰', new_event: '📅', subscribed_game: '🎮', slot_vacated: '🚪',
    member_returned: '🔙', bench_promoted: '🎉', roster_reassigned: '🔄', tentative_displaced: '⏳',
    event_rescheduled: '📆', event_cancelled: '❌', achievement_unlocked: '🏆', level_up: '⬆️',
    missed_event_nudge: '👋', recruitment_reminder: '📢', role_gap_alert: '\u26A0\uFE0F',
  };
  return map[type] ?? '🔔';
}

/** Get human-readable label for notification type. */
export function getTypeLabel(type: NotificationType): string {
  const map: Record<string, string> = {
    event_reminder: 'Event Reminder', new_event: 'New Event', subscribed_game: 'Game Activity',
    slot_vacated: 'Slot Vacated', member_returned: 'Member Returned', bench_promoted: 'Bench Promoted',
    roster_reassigned: 'Roster Reassigned', tentative_displaced: 'Tentative Displaced',
    event_rescheduled: 'Event Rescheduled', event_cancelled: 'Event Cancelled',
    achievement_unlocked: 'Achievement', level_up: 'Level Up', missed_event_nudge: 'Missed Event',
    recruitment_reminder: 'Recruitment Reminder', role_gap_alert: 'Role Gap Alert',
  };
  return map[type] ?? 'Notification';
}

/** Add a field to an embed if the payload value is truthy. */
function addFieldIf(embed: EmbedBuilder, payload: Record<string, unknown>, key: string, name: string, inline = true): void {
  if (payload[key]) embed.addFields({ name, value: toStr(payload[key]), inline });
}

/** Add a voice channel field if present. */
function addVoiceChannelField(embed: EmbedBuilder, payload: Record<string, unknown>): void {
  if (payload.voiceChannelId) embed.addFields({ name: 'Voice Channel', value: `<#${toStr(payload.voiceChannelId)}>`, inline: true });
}

/** Add type-specific fields to a notification embed. */
export function addTypeSpecificFields(embed: EmbedBuilder, type: NotificationType, payload?: Record<string, unknown>): void {
  if (!payload) return;
  switch (type) {
    case 'event_reminder': addFieldIf(embed, payload, 'eventTitle', 'Event'); addVoiceChannelField(embed, payload); break;
    case 'new_event': addFieldIf(embed, payload, 'gameName', 'Game'); addVoiceChannelField(embed, payload); break;
    case 'subscribed_game': addVoiceChannelField(embed, payload); break;
    case 'slot_vacated': case 'member_returned': addFieldIf(embed, payload, 'slotName', 'Slot'); addVoiceChannelField(embed, payload); break;
    case 'event_cancelled': addFieldIf(embed, payload, 'eventTitle', 'Event'); break;
    case 'event_rescheduled': addVoiceChannelField(embed, payload); break;
    case 'roster_reassigned':
      addFieldIf(embed, payload, 'oldRole', 'Previous Role');
      if (payload.newRole && payload.newRole !== 'player') addFieldIf(embed, payload, 'newRole', 'New Role');
      addVoiceChannelField(embed, payload); break;
    case 'bench_promoted': case 'tentative_displaced': addVoiceChannelField(embed, payload); break;
    case 'missed_event_nudge': addFieldIf(embed, payload, 'eventTitle', 'Event'); break;
    case 'role_gap_alert':
      addFieldIf(embed, payload, 'eventTitle', 'Event'); addFieldIf(embed, payload, 'gapSummary', 'Missing Roles');
      addFieldIf(embed, payload, 'rosterSummary', 'Roster'); break;
    case 'recruitment_reminder':
      addFieldIf(embed, payload, 'eventTitle', 'Event'); addFieldIf(embed, payload, 'signupSummary', 'Signups');
      addFieldIf(embed, payload, 'gameName', 'Game'); addVoiceChannelField(embed, payload); break;
  }
}

/** Build extra action rows for specific notification types (ROK-378, ROK-536). */
export function buildExtraRows(type: NotificationType, payload: Record<string, unknown> | undefined, clientUrl: string): ActionRowBuilder<ButtonBuilder>[] | undefined {
  const eventId = payload?.eventId;
  if (eventId == null) return undefined;
  const eid = toStr(eventId);

  if (type === 'role_gap_alert') return buildRoleGapExtraRows(payload, clientUrl, eid);
  if (type === 'event_reminder') return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:${eid}`).setLabel('Roach Out').setStyle(ButtonStyle.Danger).setEmoji('\uD83E\uDEB3'))];
  if (type === 'event_rescheduled') return [buildRescheduleRow(eid)];
  if (type === 'recruitment_reminder') return [buildSignupRow(eid)];
  return undefined;
}

/** Build reschedule confirm/tentative/decline row. */
function buildRescheduleRow(eventId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${RESCHEDULE_BUTTON_IDS.CONFIRM}:${eventId}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${RESCHEDULE_BUTTON_IDS.TENTATIVE}:${eventId}`).setLabel('Tentative').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${RESCHEDULE_BUTTON_IDS.DECLINE}:${eventId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
  );
}

/** Build signup/tentative/decline row for recruitment. */
function buildSignupRow(eventId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`).setLabel('Sign Up').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${SIGNUP_BUTTON_IDS.TENTATIVE}:${eventId}`).setLabel('Tentative').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${SIGNUP_BUTTON_IDS.DECLINE}:${eventId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
  );
}

/** Build cancel/reschedule deep-link buttons for role gap alerts (ROK-536). */
function buildRoleGapExtraRows(payload: Record<string, unknown> | undefined, clientUrl: string, eventId: string): ActionRowBuilder<ButtonBuilder>[] {
  const reason = payload?.suggestedReason ? encodeURIComponent(toStr(payload.suggestedReason).slice(0, 200)) : '';
  const reasonParam = reason ? `&reason=${reason}` : '';
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('Cancel Event').setStyle(ButtonStyle.Link).setURL(`${clientUrl}/events/${eventId}?action=cancel${reasonParam}`),
    new ButtonBuilder().setLabel('Reschedule').setStyle(ButtonStyle.Link).setURL(`${clientUrl}/events/${eventId}?action=reschedule${reasonParam}`),
  )];
}

/** Build the primary action button for a notification. */
export function buildPrimaryButton(type: NotificationType, notificationId: string, payload: Record<string, unknown> | undefined, clientUrl: string): ButtonBuilder | null {
  const eventId = payload?.eventId != null ? toStr(payload.eventId) : null;
  if (!eventId) return null;
  const eventTypes: NotificationType[] = ['event_reminder', 'new_event', 'subscribed_game', 'event_rescheduled', 'event_cancelled', 'recruitment_reminder', 'role_gap_alert'];
  const rosterTypes: NotificationType[] = ['slot_vacated', 'member_returned', 'bench_promoted', 'roster_reassigned', 'tentative_displaced'];
  const label = type === 'new_event' ? 'Sign Up' : rosterTypes.includes(type) ? 'View Roster' : 'View Event';
  if (eventTypes.includes(type) || rosterTypes.includes(type) || type === 'missed_event_nudge') {
    return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(`${clientUrl}/events/${eventId}?notif=${notificationId}`);
  }
  return null;
}
