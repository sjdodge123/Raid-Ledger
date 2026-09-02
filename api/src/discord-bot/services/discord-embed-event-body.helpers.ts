/**
 * ROK-1460 (slice B) — the channel-surface body of a scheduled-event embed.
 *
 * The description thins as the event moves through its lifecycle: the timing
 * line is dropped once it is LIVE, the roster survives to the end, and the
 * masked `[Open event ↗]` link closes the body — but only on an embed that
 * carries no button row (operator, sitting #3: a row already ends in a
 * `View Event` link button, so both would be duplication). Grammar table:
 * `planning-artifacts/specs/ROK-1460.md` §Grammar per state.
 */
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import { formatDurationMs } from '../utils/format-duration';
import {
  maskedLink,
  openEventLink,
} from './discord-embed-event-chrome.helpers';
import type { EmbedEventData } from './discord-embed.factory';

const CALENDAR = '\u{1F4C6}'; // 📆
const SPEAKER = '\u{1F50A}'; // 🔊
const ARROW = '\u2197'; // ↗
const SEP = '\u00B7'; // ·

/** States that still advertise when the event starts (spec §AC5 thinning). */
const TIMING_STATES: readonly EmbedState[] = [
  EMBED_STATES.POSTED,
  EMBED_STATES.FILLING,
  EMBED_STATES.FULL,
  EMBED_STATES.IMMINENT,
];

/** `📆 <t:…:f> (<t:…:R>) · 2h 14m` — the scheduled slot (spec §Grammar). */
function timingLine(event: EmbedEventData): string {
  const start = new Date(event.startTime);
  const startUnix = Math.floor(start.getTime() / 1000);
  const duration = formatDurationMs(
    new Date(event.endTime).getTime() - start.getTime(),
  );
  return `${CALENDAR} <t:${startUnix}:f> (<t:${startUnix}:R>) ${SEP} ${duration}`;
}

/** `1 person was` / `4 people were` — the count is interpolated, so agree. */
function notifiedSentence(count: number): string {
  return count === 1
    ? '1 person was signed up and has been notified.'
    : `${count} people were signed up and have been notified.`;
}

/** The CANCELLED body: what was cancelled, and who has already been told. */
function cancelledLines(event: EmbedEventData): string[] {
  const startUnix = Math.floor(new Date(event.startTime).getTime() / 1000);
  return [`Was <t:${startUnix}:f>`, notifiedSentence(event.signupCount)];
}

/** The RESCHEDULING body: the poll is the call to action. */
function reschedulingLines(pollUrl?: string | null): string[] {
  const lines = ['This event is being rescheduled via a scheduling poll.'];
  if (pollUrl) lines.push(maskedLink(`Vote now ${ARROW}`, pollUrl));
  return lines;
}

/** Push `line` onto `lines`, separated by a blank line when not first. */
function pushBlock(lines: string[], line: string): void {
  if (lines.length > 0) lines.push('');
  lines.push(line);
}

/** Inputs the body needs beyond the event itself. */
export interface EventBodyOptions {
  state: EmbedState;
  /** Already resolved (context or `CLIENT_URL`), may be absent. */
  clientUrl?: string | null;
  /** Rendered roster block, or null when there is nothing to list. */
  roster?: string | null;
  /** Scheduling-poll URL, when the RESCHEDULING caller knows it. */
  pollUrl?: string | null;
  /**
   * Emit the trailing masked `[Open event ↗]` line. The caller passes `true`
   * only when no button row will be attached (the row's `View Event` link
   * button is the same destination) — see `buildEventEmbed`.
   */
  eventLink: boolean;
}

/**
 * Build the description for one lifecycle state of a scheduled event.
 *
 * @param event - The event being rendered.
 * @param options - State, resolved client URL, roster block, poll URL and
 *   whether the trailing masked event link should be emitted.
 * @returns The joined description; `''` when the state has no body.
 */
export function buildEventBody(
  event: EmbedEventData,
  options: EventBodyOptions,
): string {
  const { state, clientUrl, roster, pollUrl, eventLink } = options;
  if (state === EMBED_STATES.CANCELLED) return cancelledLines(event).join('\n');
  if (state === EMBED_STATES.RESCHEDULING)
    return reschedulingLines(pollUrl).join('\n');

  const lines: string[] = [];
  if (TIMING_STATES.includes(state)) lines.push(timingLine(event));
  if (event.voiceChannelId) lines.push(`${SPEAKER} <#${event.voiceChannelId}>`);
  if (roster) pushBlock(lines, roster);
  if (state === EMBED_STATES.COMPLETED) {
    pushBlock(lines, signedUpLine(event));
  }
  const link = eventLink ? openEventLink(clientUrl, event.id) : null;
  if (link) pushBlock(lines, link);
  return lines.join('\n');
}

/**
 * `Signed up: 6 of 8` — reported once the event has ENDED.
 *
 * ROK-1460 F4: `signupCount` is the SIGNUP count (and for Quick Play, cumulative
 * participation) — the projection carries no attended count, so the label says
 * what it actually counts. Re-label to `Attendance` only once `EmbedEventData`
 * grows a real attended figure.
 */
function signedUpLine(event: EmbedEventData): string {
  return event.maxAttendees
    ? `Signed up: ${event.signupCount} of ${event.maxAttendees}`
    : `Signed up: ${event.signupCount}`;
}
