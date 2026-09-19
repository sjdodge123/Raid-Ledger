/**
 * ROK-1446 (Lane A) — design render 5, "Session ended".
 *
 * When the room empties, the presence message is EDITED into its own recap:
 * no completion embed is ever posted, so the channel history reads as one
 * entry per session instead of a burst of cards at the noisiest possible
 * moment (D8, design "the same message becomes the recap").
 *
 * Three things the live render does that this one must not (D3):
 *   - SHORT groups vanish. A group that never cleared the threshold started no
 *     session, so it has nothing to report — and this builder cannot render one
 *     even by accident, because it takes SESSIONS, not groups.
 *   - There is no "no game detected" field. Nobody is in the channel.
 *   - Every bar is grey and every author line carries a duration, not a
 *     head-count; ROK-1447's `'ended'` state drops the badges and puts
 *     `Attendance · N players` in their place.
 *
 * Chrome owns colour, author, footer and the timestamp default, so nothing here
 * may call `setColor` / `setAuthor` / `setFooter` (D14's guard scans for
 * exactly that in `channel-presence*.ts`).
 */
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { JUST_CHATTING_TITLE } from './channel-presence-embed.helpers';
import {
  MAX_GROUP_EMBEDS,
  UNKNOWN_CHANNEL_NAME,
} from './channel-presence-embed.lead.helpers';
import { formatRoster, ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';
import { buildQuickPlayEmbed } from './discord-embed-quickplay.helpers';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import type { RoomRecap } from './channel-presence-room-recap.helpers';
import { formatDurationMs } from '../utils/format-duration';

const SPEAKER = '\u{1F50A}'; // 🔊
const SEP = '·'; // ·
const EN_DASH = '–'; // –
/** Names before `+N more`, so the description stays under Discord's 4096. */
const MAX_RECAP_ACTIVITIES = 5;

/** Everything the recap render needs; deliberately NOT a `ResolvedRoom`. */
export interface RecapInput {
  /** `null` when the voice channel no longer resolves. */
  channelName: string | null;
  /** Every ad-hoc session this message covered (`recapEvents`, hydrated). */
  events: EmbedEventData[];
  /** The presence row's `opened_at` — the message's stable timestamp. */
  openedAt: Date;
  /**
   * The instant the room emptied (`empty_since`) — when the sessions this
   * message covered really ended. `null` only on the unbound path, where the
   * row may never have been stamped; the render then falls back to `now`.
   *
   * D5's dirty check hashes the rendered payload, so clamping to `now` instead
   * would move the hash on EVERY tick and edit Discord forever — the exact
   * churn the hash exists to prevent (S-5). `empty_since` is also the more
   * truthful answer: the session ended when the room emptied, not when the
   * flush timer last fired.
   */
  endedAt: number | null;
  /**
   * What the ROOM did, when layer 2 could reconstruct it (ROK-1499).
   *
   * Optional because the events-only callers predate it: a recap with no room
   * renders exactly as it always did. Its absence is why a three-hour room that
   * never qualified a quick-play group recapped as "No session started."
   */
  room?: RoomRecap | null;
}

/**
 * The instant a session actually ended, as the recap should report it.
 *
 * D8 renders a session that is still `live`/`grace_period` when the room
 * emptied as ENDED "with `endTime = now`". Without this clamp the recap
 * believes the row's open-ended upper bound and reports a duration hours longer
 * than the session that was really played.
 */
function sessionEnd(event: EmbedEventData, clampTo: number): number {
  return Math.min(Date.parse(event.endTime), clampTo);
}

/** `<t:epoch:t>` — Discord renders this per-reader inside a DESCRIPTION. */
function timeToken(epochMs: number): string {
  return `<t:${String(Math.floor(epochMs / 1000))}:t>`;
}

/** `2 sessions · <t:…:t>–<t:…:t>` — the ad-hoc sessions this message covered. */
function eventsLine(events: EmbedEventData[], clampTo: number): string {
  const starts = events.map((e) => Date.parse(e.startTime));
  const ends = events.map((e) => sessionEnd(e, clampTo));
  const count = events.length;
  const label = `${String(count)} session${count === 1 ? '' : 's'}`;
  const window = `${timeToken(Math.min(...starts))}${EN_DASH}${timeToken(
    Math.max(...ends),
  )}`;
  return `${label} ${SEP} ${window}`;
}

/** `Path of Exile 2 (2h 48m)`, capped so a busy room cannot blow the budget. */
function activityTokens(room: RoomRecap): string[] {
  const shown = room.activities
    .slice(0, MAX_RECAP_ACTIVITIES)
    .map((a) => `${a.name} (${formatDurationMs(a.seconds * 1000)})`);
  const hidden = room.activities.length - shown.length;
  return hidden > 0 ? [...shown, `+${String(hidden)} more`] : shown;
}

/**
 * `3 in voice · Path of Exile 2 (2h 48m) · WoW Classic (3h 29m)`.
 *
 * Order is the summariser's (longest first); the render never re-ranks.
 */
function roomLine(room: RoomRecap): string {
  const head = `${String(room.members.length)} in voice`;
  const tokens = activityTokens(room);
  if (tokens.length === 0) return `${head} ${SEP} no game detected`;
  return [head, ...tokens].join(` ${SEP} `);
}

/**
 * `**roknua** · **vex** +4 more` — WHO was in the room (ROK-1608).
 *
 * The operator's prod ask: the recap counted five people and named none of
 * them. `formatRoster` sanitises, so a display name shaped like a mention or a
 * masked link cannot ping the channel or render as a link (ROK-1460), and the
 * same `+N more` cap keeps a twenty-person room inside the description budget.
 */
function membersLine(room: RoomRecap, rosterCap: number): string {
  return formatRoster(
    room.members.map((member) => member.displayName),
    rosterCap,
  );
}

/**
 * The room first, then who was in it, then the sessions underneath.
 *
 * "No session started." survives only when there is genuinely nothing to say:
 * no session AND no reconstructable room (D3, narrowed by ROK-1499).
 */
function recapDescription(
  events: EmbedEventData[],
  clampTo: number,
  rosterCap: number,
  room?: RoomRecap | null,
): string {
  const occupied = room != null && room.members.length > 0;
  const lines = [
    occupied ? roomLine(room) : null,
    occupied ? membersLine(room, rosterCap) : null,
    events.length > 0 ? eventsLine(events, clampTo) : null,
  ].filter((line): line is string => line !== null);
  return lines.length === 0 ? 'No session started.' : lines.join('\n');
}

/** `🔊 General · session ended · 2h 55m`. Never carries a URL. */
function recapTitle(
  channelName: string | null,
  room?: RoomRecap | null,
): string {
  const head = `${SPEAKER} ${channelName ?? UNKNOWN_CHANNEL_NAME} ${SEP} session ended`;
  return room && room.spanMs > 0
    ? `${head} ${SEP} ${formatDurationMs(room.spanMs)}`
    : head;
}

/**
 * A session whose `endTime` is clamped to the recap clock.
 *
 * `buildQuickPlayEmbed` derives BOTH the duration on the author line and the
 * footer's session window from `endTime`, so the clamp has to happen on the way
 * in rather than being patched onto the rendered embed.
 */
function clamped(event: EmbedEventData, clampTo: number): EmbedEventData {
  const end = sessionEnd(event, clampTo);
  return end === Date.parse(event.endTime)
    ? event
    : { ...event, endTime: new Date(end).toISOString() };
}

/** One grey ENDED card. A gameless session titles as Just Chatting, as live. */
function buildSessionEmbed(
  event: EmbedEventData,
  context: EmbedContext,
  clock: { clampTo: number; now: number },
  rosterCap: number,
): ChannelEmbed {
  const { embed } = buildQuickPlayEmbed(
    clamped(event, clock.clampTo),
    context,
    'ended',
    clock.now,
    'playing',
    rosterCap,
  );
  if (!event.game) embed.setTitle(JUST_CHATTING_TITLE);
  return embed;
}

/** Oldest first, matching the design mock's reading order. */
function chronological(events: EmbedEventData[]): EmbedEventData[] {
  return [...events].sort(
    (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
  );
}

/**
 * Build the recap the presence message is edited into once the room empties.
 *
 * @param input - Channel name, the sessions this message covered, and the
 *   presence row's `opened_at`.
 * @param context - Community name, client URL and timezone.
 * @param now — Epoch ms the recap is rendered at. Only a fallback clock: a
 *   session still live when the room emptied is reported as having ended at
 *   `input.endedAt` (D8/S-5), and `now` is used only when the row carries no
 *   `empty_since`.
 * @param rosterCap - Names before `+N more`, in the session rosters AND in the
 *   lead embed's participant line (ROK-1608); D11's budget guard lowers it.
 * @returns The grey lead embed followed by one ENDED embed per session, oldest
 *   first, at most ten in total. Short groups appear nowhere — they started no
 *   session, so they have nothing to recap (D3).
 */
export function buildRecapEmbeds(
  input: RecapInput,
  context: EmbedContext,
  now: number = Date.now(),
  rosterCap: number = ROSTER_NAME_CAP,
): ChannelEmbed[] {
  const clampTo = input.endedAt ?? now;
  const sessions = chronological(input.events).slice(0, MAX_GROUP_EMBEDS);
  const lead = createChannelEmbed({
    state: 'done',
    communityName: context.communityName,
  });
  lead.setTimestamp(input.openedAt);
  lead.setTitle(recapTitle(input.channelName, input.room));
  lead.setDescription(
    recapDescription(input.events, clampTo, rosterCap, input.room),
  );
  return [
    lead,
    ...sessions.map((e) =>
      buildSessionEmbed(e, context, { clampTo, now }, rosterCap),
    ),
  ];
}
