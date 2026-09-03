/**
 * ROK-1462 (slice D) — invite-DM chrome.
 *
 * PUG invites, member invites and the creator relay are DMs, so they inherit
 * the DM grammar: one recipient, so a personalized field renders identically
 * for every viewer of the message. This module is the only place the three
 * builders turn a state into chrome, and the only place they build the
 * View Event link button. Colour comes from `createDmEmbed` — a family module
 * never calls `.setColor`. See `planning-artifacts/specs/ROK-1462.md` D1/D4.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  createDmEmbed,
  type DmEmbed,
  type EmbedState,
} from '../embeds/embed-chrome.helpers';
import { gameDetailUrl } from './discord-embed-event-chrome.helpers';
import { formatDurationMs } from '../utils/format-duration';

/** Author-line glyphs, spelled out so a mojibake diff stays readable. */
const DOTTED = '◌'; // ◌
const ENVELOPE = '✉'; // ✉
const SEP = '·'; // ·
const CALENDAR = '\u{1F4C5}'; // 📅

/**
 * `starts in 40 min` — how far off the event is, in words.
 *
 * @param startsAt - When the event begins.
 * @param now - Epoch ms, injected so the phrase is testable.
 * @returns `starting now` once the start time has passed.
 */
export function startsInPhrase(startsAt: Date, now: number): string {
  const ms = startsAt.getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'starting now';
  if (ms < 3_600_000) return `starts in ${Math.round(ms / 60_000)} min`;
  return `starts in ${formatDurationMs(ms)}`;
}

/** `◌ FILL NEEDED · starts in 40 min` — a slot that needs THIS reader. */
export function pugAuthorLine(startsAt: Date, now: number): string {
  return `${DOTTED} FILL NEEDED ${SEP} ${startsInPhrase(startsAt, now)}`;
}

/** `✉ INVITED · starts in 40 min` — a member invited to an existing event. */
export function memberAuthorLine(startsAt: Date, now: number): string {
  return `${ENVELOPE} INVITED ${SEP} ${startsInPhrase(startsAt, now)}`;
}

/** `✉ SERVER INVITE NEEDED` — the relay to the PUG's creator. */
export const RELAY_AUTHOR_LINE = `${ENVELOPE} SERVER INVITE NEEDED`;

/**
 * `1 spot open · 7 of 8 signed up`, or the bare count without a cap.
 *
 * @param signupCount - Confirmed signups on the event.
 * @param maxAttendees - The roster cap, when the event has one.
 * @returns The description's first line, or null when there is nothing to say.
 */
export function spotsLine(
  signupCount: number,
  maxAttendees: number | null | undefined,
): string | null {
  if (maxAttendees == null) {
    return signupCount > 0 ? `${signupCount} signed up` : null;
  }
  const open = Math.max(0, maxAttendees - signupCount);
  const spots = open === 1 ? '1 spot open' : `${open} spots open`;
  return `${spots} ${SEP} ${signupCount} of ${maxAttendees} signed up`;
}

/**
 * `📅 <t:epoch:F>` — the start time, rendered viewer-local by Discord.
 *
 * Safe in a DESCRIPTION (unlike the author line or footer, where Discord shows
 * the literal token — see `embed-chrome.helpers::assertNoTimestampMarkup`).
 *
 * @param startsAt - When the event begins.
 * @returns The calendar line.
 */
export function startTimeLine(startsAt: Date): string {
  return `${CALENDAR} <t:${Math.floor(startsAt.getTime() / 1000)}:F>`;
}

/**
 * The `View Event` link button, the ONLY route from an invite DM to the event.
 *
 * Because this button exists, the description carries no masked event link
 * (operator rule 2026-09-02: never both).
 *
 * @param clientUrl - Configured web origin, if any.
 * @param eventId - The event's id.
 * @returns The button, or null when there is no web origin to link to.
 */
export function viewEventButton(
  clientUrl: string | null | undefined,
  eventId: number,
): ButtonBuilder | null {
  if (!clientUrl) return null;
  return new ButtonBuilder()
    .setLabel('View Event')
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/events/${eventId}`);
}

/** Chrome + body inputs shared by the three invite builders. */
export interface InviteDmOptions {
  state: EmbedState;
  authorLine: string;
  communityName: string;
  /** Footer becomes `${community} · ${label}` — the slot's role, when set. */
  footerLabel?: string | null;
  title?: string;
  /** Game detail page; the title renders unlinked when absent. */
  gameId?: number | null;
  clientUrl?: string | null;
  description?: string;
  /** Game cover art. */
  coverUrl?: string | null;
}

/**
 * Create an invite DM embed with chrome, title, description and thumbnail set.
 *
 * @param opts - Chrome and body inputs.
 * @returns A `DmEmbed` — the only embed `addPersonalizedFields` accepts.
 */
export function createInviteDmEmbed(opts: InviteDmOptions): DmEmbed {
  const embed = createDmEmbed({
    state: opts.state,
    communityName: opts.communityName,
    authorLine: opts.authorLine,
    ...(opts.footerLabel ? { footerLabel: opts.footerLabel } : {}),
  });
  if (opts.title) {
    embed.setTitle(opts.title);
    const url = gameDetailUrl(opts.clientUrl, opts.gameId);
    if (url) embed.setURL(url);
  }
  if (opts.description) embed.setDescription(opts.description);
  if (opts.coverUrl) embed.setThumbnail(opts.coverUrl);
  return embed;
}

/**
 * Assemble an invite action row: the family's own buttons, then View Event.
 *
 * @param actions - Accept/Decline (or none, for the relay).
 * @param clientUrl - Configured web origin, if any.
 * @param eventId - The event the link button points at.
 * @returns The row, or undefined when it would be empty.
 */
export function buildInviteRow(
  actions: ButtonBuilder[],
  clientUrl: string | null | undefined,
  eventId: number | null | undefined,
): ActionRowBuilder<ButtonBuilder> | undefined {
  const link = eventId == null ? null : viewEventButton(clientUrl, eventId);
  const buttons = link ? [...actions, link] : actions;
  if (buttons.length === 0) return undefined;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}
