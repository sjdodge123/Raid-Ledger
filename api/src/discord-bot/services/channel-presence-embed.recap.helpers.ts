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
import { ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';
import { buildQuickPlayEmbed } from './discord-embed-quickplay.helpers';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';

const SPEAKER = '\u{1F50A}'; // 🔊
const SEP = '·'; // ·
const EN_DASH = '–'; // –

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

/** `2 sessions · <t:…:t>–<t:…:t>`, or the no-session copy (D3). */
function recapDescription(
  events: EmbedEventData[],
  clampTo: number,
): string {
  if (events.length === 0) return 'No session started.';
  const starts = events.map((e) => Date.parse(e.startTime));
  const ends = events.map((e) => sessionEnd(e, clampTo));
  const count = events.length;
  const label = `${String(count)} session${count === 1 ? '' : 's'}`;
  const window = `${timeToken(Math.min(...starts))}${EN_DASH}${timeToken(
    Math.max(...ends),
  )}`;
  return `${label} ${SEP} ${window}`;
}

/** `🔊 General · session ended`. Never carries a URL. */
function recapTitle(channelName: string | null): string {
  return `${SPEAKER} ${channelName ?? UNKNOWN_CHANNEL_NAME} ${SEP} session ended`;
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
 * @param rosterCap - Names before `+N more`; D11's budget guard lowers it.
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
  lead.setTitle(recapTitle(input.channelName));
  lead.setDescription(recapDescription(input.events, clampTo));
  return [
    lead,
    ...sessions.map((e) =>
      buildSessionEmbed(e, context, { clampTo, now }, rosterCap),
    ),
  ];
}
