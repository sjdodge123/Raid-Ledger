import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  RESCHEDULE_BUTTON_IDS,
  ROACH_OUT_BUTTON_IDS,
  SIGNUP_BUTTON_IDS,
} from '../discord-bot/discord-bot.constants';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { toStr } from './notification-embed.helpers';

/** Build extra action rows for specific notification types (ROK-378, ROK-536). */
export function buildExtraRows(
  type: NotificationType,
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ActionRowBuilder<ButtonBuilder>[] | undefined {
  const eventId = payload?.eventId;
  if (eventId == null) return undefined;
  const eid = toStr(eventId);

  if (type === 'role_gap_alert')
    return buildRoleGapExtraRows(payload, clientUrl, eid);
  if (type === 'event_reminder')
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ROACH_OUT_BUTTON_IDS.ROACH_OUT}:${eid}`)
          .setLabel('Roach Out')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('\uD83E\uDEB3'),
      ),
    ];
  if (type === 'event_rescheduled') return [buildRescheduleRow(eid)];
  if (type === 'recruitment_reminder') return [buildSignupRow(eid)];
  return undefined;
}

function buildRescheduleRow(eventId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RESCHEDULE_BUTTON_IDS.CONFIRM}:${eventId}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${RESCHEDULE_BUTTON_IDS.TENTATIVE}:${eventId}`)
      .setLabel('Tentative')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${RESCHEDULE_BUTTON_IDS.DECLINE}:${eventId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildSignupRow(eventId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.SIGNUP}:${eventId}`)
      .setLabel('Sign Up')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.TENTATIVE}:${eventId}`)
      .setLabel('Tentative')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.DECLINE}:${eventId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildRoleGapExtraRows(
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
  eventId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const reason = payload?.suggestedReason
    ? encodeURIComponent(toStr(payload.suggestedReason).slice(0, 200))
    : '';
  const reasonParam = reason ? `&reason=${reason}` : '';
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Cancel Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/events/${eventId}?action=cancel${reasonParam}`),
      new ButtonBuilder()
        .setLabel('Reschedule')
        .setStyle(ButtonStyle.Link)
        .setURL(
          `${clientUrl}/events/${eventId}?action=reschedule${reasonParam}`,
        ),
    ),
  ];
}

const EVENT_BUTTON_TYPES = new Set<NotificationType>([
  'event_reminder',
  'new_event',
  'subscribed_game',
  'event_rescheduled',
  'event_cancelled',
  'recruitment_reminder',
  'role_gap_alert',
]);
const ROSTER_BUTTON_TYPES = new Set<NotificationType>([
  'slot_vacated',
  'member_returned',
  'bench_promoted',
  'roster_reassigned',
  'tentative_displaced',
]);

/** Build the primary action button for a notification. */
export function buildPrimaryButton(
  type: NotificationType,
  notificationId: string,
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder | null {
  if (type === 'lineup_steam_nudge') {
    return new ButtonBuilder()
      .setLabel('Link Steam')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/profile/integrations`);
  }
  const eventId = payload?.eventId != null ? toStr(payload.eventId) : null;
  if (!eventId) return null;
  if (
    !EVENT_BUTTON_TYPES.has(type) &&
    !ROSTER_BUTTON_TYPES.has(type) &&
    type !== 'missed_event_nudge'
  )
    return null;
  const label =
    type === 'new_event'
      ? 'Sign Up'
      : ROSTER_BUTTON_TYPES.has(type)
        ? 'View Roster'
        : 'View Event';
  return new ButtonBuilder()
    .setLabel(label)
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/events/${eventId}?notif=${notificationId}`);
}

/** Extra buttons to add to the main action row for specific types. */
export function buildInlineButtons(
  type: NotificationType,
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder[] {
  if (type !== 'lineup_steam_nudge') return [];
  const lineupId = payload?.lineupId != null ? toStr(payload.lineupId) : null;
  if (!lineupId) return [];
  return [
    new ButtonBuilder()
      .setLabel('View Lineup')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/community-lineup/${lineupId}`),
  ];
}
