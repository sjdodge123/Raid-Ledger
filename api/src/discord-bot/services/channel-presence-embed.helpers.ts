/**
 * ROK-1446 (Lane A) — the LIVE channel-presence render.
 *
 * One bound `general-lobby` voice channel owns exactly ONE Discord message, and
 * this module turns a `ResolvedRoom` into that message's embed array: a grey
 * lead embed (`channel-presence-embed.lead.helpers`) plus one embed per
 * detected game group, capped at Discord's ten (D2/D3).
 *
 * Three rules this module exists to hold, all of which the DESIGN PROSE gets
 * wrong (spec §Design reference reconciliation — the table binds):
 *   - Rosters are bold plain names. `<@id>` mentions were considered and
 *     rejected: too loud, ~2× the character cost. `formatRoster` defangs any
 *     mention-shaped display name on the way through.
 *   - There is no button row, ever. The caller sends `components: []`; the two
 *     links are the title URL and the description's masked `[Open event ↗]`.
 *   - A SHORT group carries no event link. The mixed-room mock draws one under
 *     its amber Valheim group, but a sub-threshold group has no event to link
 *     to — linking one would be the "fake roster" the ACs forbid.
 *
 * Chrome owns colour, author, footer and the timestamp default, so nothing here
 * may call `setColor` / `setAuthor` / `setFooter` (D14's guard scans for
 * exactly that in `channel-presence*.ts`).
 *
 * NOT in this module by design: `buildRecapEmbeds` (the session-ended render,
 * design render 5) and `applyBudget` (D11's 5800-character degradation). Both
 * are the next spawn's; `buildChannelPresenceEmbeds` is the seam they plug into.
 */
import {
  coopBadge,
  priceBadge,
  type EmbedBadge,
} from '../embeds/embed-badges.helpers';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { formatRoster } from '../embeds/embed-roster.helpers';
import {
  buildLeadEmbed,
  MAX_GROUP_EMBEDS,
} from './channel-presence-embed.lead.helpers';
import type {
  GroupGameArt,
  ResolvedRoom,
  RoomGroup,
} from './channel-presence-room.helpers';
import { gameDetailUrl } from './discord-embed-event-chrome.helpers';
import { buildQuickPlayEmbed } from './discord-embed-quickplay.helpers';
import { absoluteEmbedImageUrl } from './embed-thumbnail.helpers';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';

const DOTTED = '◌'; // ◌

export {
  MAX_GROUP_EMBEDS,
  UNDETECTED_FIELD_NAME,
  UNKNOWN_CHANNEL_NAME,
} from './channel-presence-embed.lead.helpers';
export type { GroupGameArt } from './channel-presence-room.art';

/** The title a presence-null group renders under, game or not (D2). */
export const JUST_CHATTING_TITLE = '\u{1F4AC} Just Chatting'; // 💬

/** Fallback description — Discord rejects an empty description outright. */
const EMPTY_ROSTER = 'Nobody yet';

/**
 * A group ready to render.
 *
 * Once an alias for "`RoomGroup` widened with art a short group may one day
 * carry" — `resolveRoom` now populates `game` on every group (Lead ruling 1),
 * so the widening is the room type itself and this is a plain alias, kept so
 * callers and specs that named it keep compiling.
 */
export type RenderableGroup = RoomGroup;

/** Presence-null groups render as Just Chatting: no game, no art, no badges. */
function isJustChatting(group: RoomGroup): boolean {
  return group.gameId === null;
}

/** `◌ NEEDS 2 MORE` — never `NEEDS 0 MORE`, whatever the counts say. */
function needsMoreLine(group: RoomGroup, room: ResolvedRoom): string {
  const missing = room.minPlayers - group.memberIds.length;
  return `${DOTTED} NEEDS ${String(Math.max(1, missing))} MORE`;
}

/** The two inline badges, in a fixed order, never a placeholder. */
function badgeFields(
  art: GroupGameArt | null | undefined,
  now: number,
): Array<EmbedBadge & { inline: true }> {
  if (!art?.badges) return [];
  return [coopBadge(art.badges), priceBadge(art.badges, now)]
    .filter((b): b is EmbedBadge => b !== null)
    .map((b) => ({ ...b, inline: true }));
}

/**
 * Build the amber "below threshold" embed for a group with no event.
 *
 * No event exists, so there is no link, no attendance and no signup language —
 * only the roster and how many more people would make a session (AC4).
 *
 * @param group - The short group, optionally carrying cover art and badges.
 * @param room - The room it sits in; supplies `minPlayers`.
 * @param context - Community name, client URL and timezone.
 * @param now - Epoch ms the price badge ages against.
 * @returns The amber `ChannelEmbed`. Carries no timestamp: nothing started.
 */
export function buildShortGroupEmbed(
  group: RenderableGroup,
  room: ResolvedRoom,
  context: EmbedContext,
  now: number,
): ChannelEmbed {
  const chatting = isJustChatting(group);
  const embed = createChannelEmbed({
    state: 'needs_you',
    communityName: context.communityName,
    authorLine: needsMoreLine(group, room),
    timestamp: false,
  });
  embed.setTitle(chatting ? JUST_CHATTING_TITLE : group.gameName);
  const url = chatting
    ? null
    : gameDetailUrl(context.clientUrl, group.gameId ?? undefined);
  if (url) embed.setURL(url);
  embed.setDescription(formatRoster(group.memberNames) || EMPTY_ROSTER);
  if (chatting) return embed;

  const fields = badgeFields(group.game, now);
  if (fields.length > 0) embed.addFields(fields);
  const thumbnail = absoluteEmbedImageUrl(group.game?.coverUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

/**
 * A Just Chatting group has no game, so the Quick Play builder must not see
 * one: with `game: null` it emits no title URL, no thumbnail and no badges by
 * itself, and the title is then overridden to `💬 Just Chatting` (D2).
 */
function quickPlayInput(event: EmbedEventData, chatting: boolean) {
  return chatting ? { ...event, game: null } : event;
}

/** The green LIVE embed, straight from ROK-1447's shipped builder. */
function buildEventedGroupEmbed(
  group: RoomGroup,
  event: EmbedEventData,
  context: EmbedContext,
  now: number,
): ChannelEmbed {
  const chatting = isJustChatting(group);
  const { embed } = buildQuickPlayEmbed(
    quickPlayInput(event, chatting),
    context,
    'live',
    now,
    chatting ? 'in voice' : 'playing',
  );
  if (chatting) embed.setTitle(JUST_CHATTING_TITLE);
  return embed;
}

/**
 * Evented ⇔ `eventData !== null`, NEVER `qualifying`.
 *
 * The two are separate facts: an event outlives a departure, so a group can be
 * below `minPlayers` and still own a live session. `qualifying` only feeds the
 * `◌ NEEDS N MORE` copy (room handover note 1).
 */
function buildGroupEmbed(
  group: RenderableGroup,
  room: ResolvedRoom,
  context: EmbedContext,
  now: number,
): ChannelEmbed {
  return group.eventData === null
    ? buildShortGroupEmbed(group, room, context, now)
    : buildEventedGroupEmbed(group, group.eventData, context, now);
}

/**
 * Render the whole live message for one bound voice channel.
 *
 * @param room - The resolved room. `groups` is consumed in the order
 *   `resolveRoom` produced (evented first, then size desc, then name asc) —
 *   re-sorting here would pick a different nine than overflow was computed for.
 * @param context - Community name, client URL and timezone.
 * @param now - Epoch ms the price badges age against; defaults to the clock.
 * @param openedAt - When the presence row opened; the lead embed's timestamp.
 * @returns Lead embed first, then up to `MAX_GROUP_EMBEDS` group embeds — at
 *   most ten, Discord's hard ceiling. The caller sends `components: []`.
 */
export function buildChannelPresenceEmbeds(
  room: ResolvedRoom,
  context: EmbedContext,
  now: number = Date.now(),
  openedAt: Date = new Date(now),
): ChannelEmbed[] {
  const shown = room.groups.slice(0, MAX_GROUP_EMBEDS);
  const overflow = room.groups.slice(MAX_GROUP_EMBEDS);
  return [
    buildLeadEmbed(room, context, openedAt, overflow),
    ...shown.map((g) => buildGroupEmbed(g, room, context, now)),
  ];
}
