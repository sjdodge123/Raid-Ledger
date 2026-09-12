/**
 * ROK-1446 (Lane A) — the grey LEAD embed of the channel-presence message.
 *
 * Split out of `channel-presence-embed.helpers.ts` to stay inside the 300-line
 * cap: the lead embed owns the channel header, the room's occupancy, the
 * "no game detected" roster and the group-overflow notice, which is a cohesive
 * unit with no overlap with the per-group renderers.
 *
 * D3 binds here, NOT the design mock: the lead embed is emitted for EVERY
 * render — a single group and a Just Chatting room included. The design's
 * "Decide: is the grey lead embed worth its height when there is only one
 * group?" and its "no lead embed" note on the Just Chatting render are both
 * superseded (spec §Design reference reconciliation, traps 3 and 4).
 *
 * The chrome owns colour, author, footer and the timestamp default — this
 * module must never call `setColor` / `setAuthor` / `setFooter` (D14 guard).
 */
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { formatRoster, ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';
import type { ResolvedRoom, RoomGroup } from './channel-presence-room.helpers';
import type { EmbedContext } from './discord-embed.factory';

const SPEAKER = '\u{1F50A}'; // 🔊
const SEP = '·'; // ·

/**
 * Group embeds a single message may carry.
 *
 * Discord allows ten embeds per message and the lead embed always takes one
 * (D3), so nine groups is the ceiling. Anything past that is named in the
 * lead's overflow field rather than silently dropped.
 */
export const MAX_GROUP_EMBEDS = 9;

/** Title fallback when the voice channel no longer resolves (room note 6). */
export const UNKNOWN_CHANNEL_NAME = 'Voice channel';

/** The lead field listing members whose presence produced no game (D3). */
export const UNDETECTED_FIELD_NAME = `In channel ${SEP} no game detected`;

/** `🔊 General · 5 in voice`. Never carries a URL — there is nothing to open. */
function leadTitle(room: ResolvedRoom): string {
  const name = room.channelName ?? UNKNOWN_CHANNEL_NAME;
  return `${SPEAKER} ${name} ${SEP} ${String(room.memberCount)} in voice`;
}

/**
 * The description for a room whose groups have no event yet (ROK-1521).
 *
 * `Nobody on a tracked game yet.` is a PRE-DETECTION line ("we don't know what
 * anyone is playing"), so it may only fire when NOTHING is rendered beneath the
 * lead. Two later states print a roster the line would otherwise deny:
 *
 *  - `qualifying` groups waiting out SPAWN_DELAY_MS (operator ruling
 *    2026-09-04) — their event does not exist yet, but one is coming.
 *  - groups BELOW `minPlayers`, which `partitionLobbyGroups` drops to
 *    `qualifying: false`. They render amber as `NEEDS N MORE`; nothing is
 *    forming, but the game and the players are on screen.
 *
 * Returns `null` when the lead has nothing to add: a room with no groups but
 * with undetected members already states that fact in its field, and the
 * description must not restate it in different words.
 */
function preSessionDescription(room: ResolvedRoom): string | null {
  if (room.groups.length === 0) {
    return room.undetectedNames.length > 0
      ? null
      : 'Nobody on a tracked game yet.';
  }
  const forming = room.groups.filter((g) => g.qualifying).length;
  if (forming === 1) return '1 group forming.';
  if (forming > 1) return `${String(forming)} groups forming.`;
  const gathering = room.groups.length;
  return gathering === 1
    ? '1 group gathering players.'
    : `${String(gathering)} groups gathering players.`;
}

/**
 * The one-line summary under the channel header.
 *
 * "Everyone here is on the same game." is gated on the single group actually
 * being a GAME: the design's Just Chatting render shows `1 session running.`
 * for its lone null-game group, so a `gameId === null` group falls through to
 * the session count.
 */
function leadDescription(room: ResolvedRoom): string | null {
  const evented = room.groups.filter((g) => g.eventData !== null).length;
  if (evented === 0) return preSessionDescription(room);
  const [only] = room.groups;
  if (
    room.groups.length === 1 &&
    room.undetectedNames.length === 0 &&
    only.gameId !== null
  ) {
    return 'Everyone here is on the same game.';
  }
  return evented === 1
    ? '1 session running.'
    : `${String(evented)} sessions running.`;
}

/** `+3 more groups` — the groups past `MAX_GROUP_EMBEDS`, named not dropped. */
function overflowField(
  overflow: readonly RoomGroup[],
  rosterCap: number,
): { name: string; value: string } | null {
  if (overflow.length === 0) return null;
  return {
    name: `+${String(overflow.length)} more groups`,
    value: formatRoster(
      overflow.map((g) => g.gameName),
      rosterCap,
    ),
  };
}

/**
 * Build the grey lead embed for a live channel-presence render.
 *
 * @param room - The resolved room, already in render order.
 * @param context - Community name, client URL and timezone.
 * @param openedAt - When the presence row was opened; the embed's timestamp.
 * @param overflow - Groups past `MAX_GROUP_EMBEDS`, named in a field (D2).
 * @param rosterCap - Names before `+N more`; D11's budget guard lowers it.
 * @returns The lead `ChannelEmbed`. Always emitted, whatever the group count.
 */
export function buildLeadEmbed(
  room: ResolvedRoom,
  context: EmbedContext,
  openedAt: Date,
  overflow: readonly RoomGroup[] = [],
  rosterCap: number = ROSTER_NAME_CAP,
): ChannelEmbed {
  const embed = createChannelEmbed({
    state: 'done',
    communityName: context.communityName,
  });
  embed.setTimestamp(openedAt);
  embed.setTitle(leadTitle(room));
  const description = leadDescription(room);
  if (description) embed.setDescription(description);

  const fields: Array<{ name: string; value: string }> = [];
  // `undetectedNames` is already empty when `allowJustChatting` is on — those
  // members render as their own group and D3 forbids listing them twice.
  const undetected = formatRoster(room.undetectedNames, rosterCap);
  if (undetected) {
    fields.push({ name: UNDETECTED_FIELD_NAME, value: undetected });
  }
  const more = overflowField(overflow, rosterCap);
  if (more) fields.push(more);
  if (fields.length > 0) embed.addFields(fields);

  return embed;
}
