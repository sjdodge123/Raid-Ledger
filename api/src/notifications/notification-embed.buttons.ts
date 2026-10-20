import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { buildHubProposalButton } from './notification-embed.hub-proposal';
import {
  RESCHEDULE_BUTTON_IDS,
  ROACH_OUT_BUTTON_IDS,
  RUNNING_LATE_BUTTON_IDS,
  SIGNUP_BUTTON_IDS,
} from '../discord-bot/discord-bot.constants';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { toStr } from './notification-embed.helpers';
import { buildLfgPlayerInviteRow } from './notification-embed.lfg-player-invite';
import { VOICE_ACCESS_LOST_SUBTYPE } from './voice-access-lost.helpers';

/** Build extra action rows for specific notification types (ROK-378, ROK-536). */
export function buildExtraRows(
  type: NotificationType,
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ActionRowBuilder<ButtonBuilder>[] | undefined {
  // ROK-1455 D12: an invite payload carries a gameId, not an eventId, so this
  // branch MUST sit above the eventId guard — below it, it is dead code.
  if (type === 'lfg_player_invite') {
    const row = buildLfgPlayerInviteRow(payload);
    return row ? [row] : undefined;
  }
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
        new ButtonBuilder()
          .setCustomId(`${RUNNING_LATE_BUTTON_IDS.LATE}:${eid}`)
          .setLabel('Running Late')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('\u23F0'),
      ),
    ];
  if (type === 'event_rescheduled') return [buildRescheduleRow(eid)];
  if (type === 'recruitment_reminder') return [buildSignupRow(eid)];
  // ROK-1371 event path: the DM carries the NEW follow-up event's signup row.
  if (type === 'post_event_followup') return [buildSignupRow(eid)];
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
  'hub_event_tagged',
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
  if (type === 'community_lineup') {
    return buildLineupButton(payload, clientUrl);
  }
  // ROK-1371 poll path: payload carries {lineupId, matchId} → "Vote on a Time"
  // deep-link. Placed before the eventId gate because the poll payload has no
  // eventId (which would otherwise short-circuit to null).
  if (type === 'post_event_followup') {
    return buildLineupButton(payload, clientUrl);
  }
  // ROK-1832: a leader post carries a guildId, not an eventId.
  if (type === 'hub_leader_post') return buildGroupButton(payload, clientUrl);
  if (type === 'hub_proposal_submitted' || type === 'hub_proposal_reviewed')
    return buildHubProposalButton(payload, clientUrl);
  const eventId = payload?.eventId != null ? toStr(payload.eventId) : null;
  if (!eventId) return null;
  if (
    !EVENT_BUTTON_TYPES.has(type) &&
    !ROSTER_BUTTON_TYPES.has(type) &&
    type !== 'missed_event_nudge'
  )
    return null;
  // ROK-1769: the lost-voice-access DM's button is the way back in.
  const isSignUp =
    type === 'new_event' || payload?.subtype === VOICE_ACCESS_LOST_SUBTYPE;
  const label = isSignUp
    ? 'Sign Up'
    : ROSTER_BUTTON_TYPES.has(type)
      ? 'View Roster'
      : 'View Event';
  return new ButtonBuilder()
    .setLabel(label)
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/events/${eventId}?notif=${notificationId}`);
}

/** Build the primary button for community_lineup DMs based on subtype. */
function buildLineupButton(
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder | null {
  const sub = payload?.subtype as string | undefined;
  const lineupId = payload?.lineupId != null ? toStr(payload.lineupId) : null;
  const matchId = payload?.matchId != null ? toStr(payload.matchId) : null;
  const eventId = payload?.eventId != null ? toStr(payload.eventId) : null;

  if (sub === 'lineup_event_created' && eventId) {
    return new ButtonBuilder()
      .setLabel('View Event')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/events/${eventId}`);
  }
  if (matchId && lineupId) {
    return buildScheduleButton(sub, payload, lineupId, matchId, clientUrl);
  }
  if (lineupId) {
    return new ButtonBuilder()
      .setLabel('View Lineup')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/community-lineup/${lineupId}`);
  }
  return null;
}

/** Discord's hard cap on a button label. */
const BUTTON_LABEL_MAX = 80;

/**
 * Creator DMs whose primary button is the one-tap lock link, not the generic
 * vote link. ROK-1604 (expiry warning) and ROK-1632 (everyone picked a time)
 * both name a single slot worth locking in.
 */
const LOCK_BUTTON_SUBTYPES = new Set([
  'scheduling_poll_expiry_warning',
  'scheduling_poll_unanimous_time',
]);

/**
 * The slot a lock-in DM's Lock button targets, or null when the DM is not a
 * lock subtype or carries no `slotId` (then it keeps the plain vote link).
 */
function lockSlotId(
  sub: string | undefined,
  payload: Record<string, unknown> | undefined,
): string | null {
  if (!sub || !LOCK_BUTTON_SUBTYPES.has(sub)) return null;
  return payload?.slotId != null ? toStr(payload.slotId) : null;
}

/**
 * Poll-page button for a lineup DM that names a match.
 *
 * ROK-1604: the creator's expiry warning carries `slotId` + `lockLabel` and
 * links with `?lock=<slotId>`, which opens the lock-in CONFIRM on the page
 * (never a direct commit). Every other subtype keeps the plain vote link.
 * ROK-1784: a lock DM also gets a plain "Open Poll" inline button
 * (`buildOpenPollButton`).
 */
function buildScheduleButton(
  sub: string | undefined,
  payload: Record<string, unknown> | undefined,
  lineupId: string,
  matchId: string,
  clientUrl: string,
): ButtonBuilder {
  const pollUrl = `${clientUrl}/community-lineup/${lineupId}/schedule/${matchId}`;
  const slotId = lockSlotId(sub, payload);
  if (slotId) {
    const label =
      typeof payload?.lockLabel === 'string' && payload.lockLabel
        ? payload.lockLabel
        : 'Lock in a time';
    return new ButtonBuilder()
      .setLabel(label.slice(0, BUTTON_LABEL_MAX))
      .setStyle(ButtonStyle.Link)
      .setURL(`${pollUrl}?lock=${encodeURIComponent(slotId)}`);
  }
  return new ButtonBuilder()
    .setLabel(sub === 'event_rescheduling' ? 'Vote Now' : 'Vote on a Time')
    .setStyle(ButtonStyle.Link)
    .setURL(pollUrl);
}

/**
 * ROK-1784: a lock-in DM's primary button is the `?lock=` confirm, so the
 * recipient also needs a plain link that just opens the poll. Returns null
 * for every DM whose primary button is not the Lock link.
 */
function buildOpenPollButton(
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder | null {
  const lineupId = payload?.lineupId != null ? toStr(payload.lineupId) : null;
  const matchId = payload?.matchId != null ? toStr(payload.matchId) : null;
  const sub = payload?.subtype as string | undefined;
  if (!lineupId || !matchId || !lockSlotId(sub, payload)) return null;
  return new ButtonBuilder()
    .setLabel('Open Poll')
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/community-lineup/${lineupId}/schedule/${matchId}`);
}

/** Plain "View Lineup" link to the lineup page. */
function viewLineupButton(clientUrl: string, lineupId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel('View Lineup')
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/community-lineup/${lineupId}`);
}

/** Extra buttons to add to the main action row for specific types. */
export function buildInlineButtons(
  type: NotificationType,
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder[] {
  if (type === 'lineup_steam_nudge') {
    const lineupId = payload?.lineupId != null ? toStr(payload.lineupId) : null;
    if (!lineupId) return [];
    return [viewLineupButton(clientUrl, lineupId)];
  }
  if (type === 'community_lineup') {
    const sub = payload?.subtype as string | undefined;
    const lineupId = payload?.lineupId != null ? toStr(payload.lineupId) : null;
    if (!lineupId) return [];
    const openPoll = buildOpenPollButton(payload, clientUrl);
    if (openPoll) return [openPoll];
    // Only add View Lineup inline when primary button goes elsewhere
    const needsInline =
      sub === 'lineup_match_member' ||
      sub === 'lineup_event_created' ||
      sub === 'lineup_scheduling_open';
    if (!needsInline) return [];
    return [viewLineupButton(clientUrl, lineupId)];
  }
  return [];
}

/** ROK-1832: "View group" link for a leader post; null without a guildId. */
function buildGroupButton(
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder | null {
  const guildId = payload?.guildId;
  if (typeof guildId !== 'number') return null;
  return new ButtonBuilder()
    .setLabel('View group')
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/guilds/${guildId}`);
}
