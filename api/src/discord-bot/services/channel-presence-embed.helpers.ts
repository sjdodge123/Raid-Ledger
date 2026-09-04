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
import { formatRoster, ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';
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

/**
 * The amber author line for a group that owns no event.
 *
 * TWO states share the amber bar and only one of them may say "needs":
 *   - below `minPlayers` → `◌ NEEDS N MORE` (D2).
 *   - at or above `minPlayers` with no event YET → `◌ N playing`.
 *
 * D2 only ever defined "short group (below `minPlayers`)", so the second state
 * is a quadrant the design never enumerated — yet it is the state of every new
 * session for its first `SPAWN_DELAY_MS` (15 minutes,
 * `voice-state-join-dispatch.handlers.ts:33`), because `findLinkedEvents` has
 * nothing to return until the delayed spawn fires. Routing it through the
 * "needs" copy printed `◌ NEEDS 1 MORE` directly above a roster that had
 * ALREADY cleared the threshold (review F-1): `2 - 3 = -1`, clamped back up to
 * 1 by a `Math.max` whose own comment ("never `NEEDS 0 MORE`, whatever the
 * counts say") is what hid the contradiction for the whole window.
 *
 * INTERIM COPY — Lead ruling 2026-09-04, pending an operator decision. Amber is
 * kept because the group is genuinely not live yet; `N playing` reuses
 * vocabulary that already exists in the approved design rather than inventing a
 * new state name; and above all it stops the embed stating something false.
 * This is one line to change when the operator rules — do not invent
 * alternative wording (`STARTING SOON`, `READY`, …) in the meantime.
 */
function shortAuthorLine(group: RoomGroup, room: ResolvedRoom): string {
  const missing = room.minPlayers - group.memberIds.length;
  // `qualifying` is the room layer's threshold verdict; `missing <= 0`
  // re-derives it from the counts actually being rendered so a stale or absent
  // flag can never route a full group into the "needs" copy. That pair is the
  // invariant — `NEEDS N MORE` is now reachable only when N is genuinely
  // positive — which is why the old `Math.max(1, missing)` clamp is gone: a
  // clamp turns a broken branch into plausible copy instead of a visible fault.
  if (group.qualifying || missing <= 0) {
    // Noun follows the operator's 2026-09-04 Just Chatting ruling: a null
    // `gameId` group is by definition not playing anything, so counting them as
    // `playing` would restate the very falsehood F-1 was about. Applying the
    // existing ruling to this quadrant, not inventing vocabulary for it.
    const noun = group.gameId === null ? 'in voice' : 'playing';
    return `${DOTTED} ${String(group.memberIds.length)} ${noun}`;
  }
  return `${DOTTED} NEEDS ${String(missing)} MORE`;
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
 * Build the amber "no event yet" embed for a group with no event.
 *
 * No event exists, so there is no link, no attendance and no signup language —
 * only the roster and, per `shortAuthorLine`, either how many more people would
 * make a session or (once the threshold is already met) the head count (AC4).
 *
 * @param group - The short group, optionally carrying cover art and badges.
 * @param room - The room it sits in; supplies `minPlayers`.
 * @param context - Community name, client URL and timezone.
 * @param now - Epoch ms the price badge ages against.
 * @param rosterCap - Names before `+N more`; D11's budget guard lowers it.
 * @returns The amber `ChannelEmbed`. Carries no timestamp: nothing started.
 */
export function buildShortGroupEmbed(
  group: RenderableGroup,
  room: ResolvedRoom,
  context: EmbedContext,
  now: number,
  rosterCap: number = ROSTER_NAME_CAP,
): ChannelEmbed {
  const chatting = isJustChatting(group);
  const embed = createChannelEmbed({
    state: 'needs_you',
    communityName: context.communityName,
    authorLine: shortAuthorLine(group, room),
    timestamp: false,
  });
  embed.setTitle(chatting ? JUST_CHATTING_TITLE : group.gameName);
  const url = chatting
    ? null
    : gameDetailUrl(context.clientUrl, group.gameId ?? undefined);
  if (url) embed.setURL(url);
  embed.setDescription(
    formatRoster(group.memberNames, rosterCap) || EMPTY_ROSTER,
  );
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
  rosterCap: number,
): ChannelEmbed {
  const chatting = isJustChatting(group);
  const { embed } = buildQuickPlayEmbed(
    quickPlayInput(event, chatting),
    context,
    'live',
    now,
    chatting ? 'in voice' : 'playing',
    rosterCap,
  );
  if (chatting) embed.setTitle(JUST_CHATTING_TITLE);
  return embed;
}

/**
 * Evented ⇔ `eventData !== null`, NEVER `qualifying`.
 *
 * The two are separate facts, and all FOUR combinations occur:
 *   - ✓/✓ and ✗/✓ → the LIVE render. An event outlives a departure, so a group
 *     can be below `minPlayers` and still own a live session — which is why
 *     this branch reads `eventData` and never `qualifying`.
 *   - ✗/✗ → `◌ NEEDS N MORE`.
 *   - ✓/✗ → `◌ N playing`. Not below threshold, just not spawned yet.
 *
 * `qualifying` therefore selects between the two AMBER copies (in
 * `shortAuthorLine`) and never between amber and LIVE. Reading it here instead
 * would flip a departure-outliving session back to amber (room handover note 1).
 */
function buildGroupEmbed(
  group: RenderableGroup,
  room: ResolvedRoom,
  context: EmbedContext,
  now: number,
  rosterCap: number,
): ChannelEmbed {
  return group.eventData === null
    ? buildShortGroupEmbed(group, room, context, now, rosterCap)
    : buildEventedGroupEmbed(group, group.eventData, context, now, rosterCap);
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
 * @param rosterCap - Names rendered per roster before `+N more`. D11's
 *   `applyBudget` re-renders at a lower cap when the message would breach
 *   Discord's character ceiling; every other caller takes the default.
 * @returns Lead embed first, then up to `MAX_GROUP_EMBEDS` group embeds — at
 *   most ten, Discord's hard ceiling. The caller sends `components: []`.
 */
export function buildChannelPresenceEmbeds(
  room: ResolvedRoom,
  context: EmbedContext,
  now: number = Date.now(),
  openedAt: Date = new Date(now),
  rosterCap: number = ROSTER_NAME_CAP,
): ChannelEmbed[] {
  const shown = room.groups.slice(0, MAX_GROUP_EMBEDS);
  const overflow = room.groups.slice(MAX_GROUP_EMBEDS);
  return [
    buildLeadEmbed(room, context, openedAt, overflow, rosterCap),
    ...shown.map((g) => buildGroupEmbed(g, room, context, now, rosterCap)),
  ];
}
