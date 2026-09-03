/**
 * ROK-1462 (slice D) — the three invite DM builders.
 *
 * All three moved onto the shared DM chrome (`createInviteDmEmbed`): amber for
 * a fill request, slate-free author lines that carry the state, and a
 * `View Event` link button instead of a masked event link in the description.
 * Only the PUG invite may carry personalized fields — it is the one DM whose
 * reader is the subject. See `planning-artifacts/specs/ROK-1462.md` D1/D2/D4.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type * as schema from '../../drizzle/schema';
import {
  PUG_BUTTON_IDS,
  MEMBER_INVITE_BUTTON_IDS,
} from '../discord-bot.constants';
import {
  addPersonalizedFields,
  type PersonalizedField,
} from '../embeds/embed-personalized.helpers';
import type { DmEmbed } from '../embeds/embed-chrome.helpers';
import {
  createInviteDmEmbed,
  buildInviteRow,
  memberAuthorLine,
  pugAuthorLine,
  spotsLine,
  startTimeLine,
  RELAY_AUTHOR_LINE,
} from './pug-invite-chrome.helpers';

/** What every invite DM needs to render its chrome and body. */
interface InviteBase {
  eventId: number;
  event: typeof schema.events.$inferSelect;
  communityName: string;
  clientUrl: string | null;
  voiceChannelId: string | null;
  /** Game cover art, when the caller hydrated it. */
  coverUrl?: string | null;
  /** Epoch ms; injected so the author line is testable. */
  now?: number;
}

/** Inputs for the PUG fill-request DM. */
export interface PugInviteInput extends InviteBase {
  pugSlotId: string;
  /** The slot's role, rendered in the footer when present. */
  role?: string | null;
  /** Signups holding a spot; drives `7 of 8 signed up`. Null = unknown. */
  signupCount?: number | null;
  /** At most two, already prioritised by `pug-invite-personalization`. */
  personalized?: readonly PersonalizedField[];
}

/** Inputs for the member invite DM (ROK-292). */
export interface MemberInviteInput extends InviteBase {
  notificationId: string;
  /** Signups holding a spot; drives `7 of 8 signed up`. Null = unknown. */
  signupCount?: number | null;
}

/** Optional event context for the creator relay DM. */
export interface InviteRelayOptions {
  communityName?: string | null;
  clientUrl?: string | null;
  eventId?: number | null;
}

/** The shape every builder returns: an embed plus its (optional) button row. */
export interface InviteDm {
  embed: DmEmbed;
  row: ActionRowBuilder<ButtonBuilder> | undefined;
}

/** Add the optional voice channel field to an invite embed. */
function addVoiceField(embed: DmEmbed, voiceChannelId: string | null): void {
  if (!voiceChannelId) return;
  embed.addFields({
    name: 'Voice Channel',
    value: `<#${voiceChannelId}>`,
    inline: true,
  });
}

/**
 * `1 spot open · 7 of 8 signed up` over `📅 <t:…:F>`.
 *
 * A null count drops the spots line rather than defaulting it to 0 — see
 * `pug-invite-personalization.helpers::countSignedUp`.
 */
function inviteDescription(
  input: InviteBase,
  signupCount: number | null,
): string {
  const spots = spotsLine(signupCount, input.event.maxAttendees);
  return [spots, startTimeLine(input.event.duration[0])]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

/** Accept/Decline for a PUG slot. */
function pugActionButtons(pugSlotId: string): ButtonBuilder[] {
  return [
    new ButtonBuilder()
      .setCustomId(`${PUG_BUTTON_IDS.ACCEPT}:${pugSlotId}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PUG_BUTTON_IDS.DECLINE}:${pugSlotId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  ];
}

/** Accept/Decline for a member invite. */
function memberActionButtons(
  eventId: number,
  notificationId: string,
): ButtonBuilder[] {
  return [
    new ButtonBuilder()
      .setCustomId(
        `${MEMBER_INVITE_BUTTON_IDS.ACCEPT}:${eventId}:${notificationId}`,
      )
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(
        `${MEMBER_INVITE_BUTTON_IDS.DECLINE}:${eventId}:${notificationId}`,
      )
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  ];
}

/**
 * Hard cap on reader-specific fields in a fill-request DM (spec D2 / AC1).
 *
 * The sourcing module already picks at most two, but the cap is a property of
 * the RENDER — a third badge pushes the spots line and the Accept button below
 * the fold — so the builder enforces it for every caller rather than trusting
 * each one to have sliced first.
 */
export const MAX_PERSONALIZED_FIELDS = 2;

/**
 * Build the PUG fill-request DM (amber `needs_you`).
 *
 * @param input - Slot, event, branding and the personalized fields. Anything
 *   past the first {@link MAX_PERSONALIZED_FIELDS} is dropped, so the caller's
 *   priority ORDER is what decides which badges survive.
 * @returns The DM embed and its Accept / Decline / View Event row.
 */
export function buildPugInviteEmbed(input: PugInviteInput): InviteDm {
  const now = input.now ?? Date.now();
  const embed = createInviteDmEmbed({
    state: 'needs_you',
    authorLine: pugAuthorLine(input.event.duration[0], now),
    communityName: input.communityName,
    footerLabel: input.role ?? null,
    title: input.event.title,
    gameId: input.event.gameId,
    clientUrl: input.clientUrl,
    description: inviteDescription(input, input.signupCount ?? null),
    coverUrl: input.coverUrl ?? null,
  });

  addVoiceField(embed, input.voiceChannelId);
  addPersonalizedFields(
    embed,
    (input.personalized ?? []).slice(0, MAX_PERSONALIZED_FIELDS),
  );

  return {
    embed,
    row: buildInviteRow(
      pugActionButtons(input.pugSlotId),
      input.clientUrl,
      input.eventId,
    ),
  };
}

/**
 * Build the member invite DM (ROK-292) — same chrome, no personalized fields.
 *
 * The reader is being invited, not evaluated: a library badge here would be a
 * statement about someone the message is not addressed to (spec D4).
 *
 * @param input - Event, notification id and branding.
 * @returns The DM embed and its Accept / Decline / View Event row.
 */
export function buildMemberInviteEmbed(input: MemberInviteInput): InviteDm {
  const now = input.now ?? Date.now();
  const embed = createInviteDmEmbed({
    state: 'needs_you',
    authorLine: memberAuthorLine(input.event.duration[0], now),
    communityName: input.communityName,
    title: input.event.title,
    gameId: input.event.gameId,
    clientUrl: input.clientUrl,
    description: inviteDescription(input, input.signupCount ?? null),
    coverUrl: input.coverUrl ?? null,
  });

  addVoiceField(embed, input.voiceChannelId);

  return {
    embed,
    row: buildInviteRow(
      memberActionButtons(input.eventId, input.notificationId),
      input.clientUrl,
      input.eventId,
    ),
  };
}

/**
 * Build the server-invite relay DM sent to the PUG's creator.
 *
 * Goes to the creator, not the invitee, so it carries no personalized field
 * and sits in `announcing` rather than `needs_you` (spec D4).
 *
 * @param pugUsername - The Discord username that is not in the guild yet.
 * @param inviteUrl - The single-use guild invite to relay.
 * @param opts - Branding plus the event context for the link button, if known.
 * @returns The DM embed and its View Event row when an event link exists.
 */
export function buildInviteRelayEmbed(
  pugUsername: string,
  inviteUrl: string,
  opts: InviteRelayOptions = {},
): InviteDm {
  const embed = createInviteDmEmbed({
    state: 'announcing',
    authorLine: RELAY_AUTHOR_LINE,
    communityName: opts.communityName ?? '',
    title: `${pugUsername} isn't in the server yet`,
    description: [
      'Share this invite link with them:',
      '',
      inviteUrl,
      '',
      "Once they join, they'll automatically receive the raid invite.",
    ].join('\n'),
  });

  return {
    embed,
    row: buildInviteRow([], opts.clientUrl, opts.eventId),
  };
}
