/**
 * ROK-1460 (slice B) — the channel-surface body of a scheduled-event embed.
 *
 * The description thins as the event moves through its lifecycle: the timing
 * line is dropped once it is LIVE, the roster survives to the end, and the
 * masked `[Open event ↗]` link is always the last line. Grammar table:
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
const ARROW = '↗'; // ↗

/** States that still advertise when the event starts (spec §AC5 thinning). */
const TIMING_STATES: readonly EmbedState[] = [
  EMBED_STATES.POSTED,
  EMBED_STATES.FILLING,
  EMBED_STATES.FULL,
  EMBED_STATES.IMMINENT,
];

/** `📆 <t:…:f> (<t:…:R>) (2h 14m)` — the scheduled slot. */
function timingLine(event: EmbedEventData): string {
  const start = new Date(event.startTime);
  const startUnix = Math.floor(start.getTime() / 1000);
  const duration = formatDurationMs(
    new Date(event.endTime).getTime() - start.getTime(),
  );
  return `${CALENDAR} <t:${startUnix}:f> (<t:${startUnix}:R>) (${duration})`;
}

/** The CANCELLED body: what was cancelled, and who has already been told. */
function cancelledLines(event: EmbedEventData): string[] {
  const startUnix = Math.floor(new Date(event.startTime).getTime() / 1000);
  return [
    `Was <t:${startUnix}:f>`,
    `${event.signupCount} people were signed up and have been notified.`,
  ];
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
}

/**
 * Build the description for one lifecycle state of a scheduled event.
 *
 * @param event - The event being rendered.
 * @param options - State, resolved client URL, roster block and poll URL.
 * @returns The joined description; `''` when the state has no body.
 */
export function buildEventBody(
  event: EmbedEventData,
  options: EventBodyOptions,
): string {
  const { state, clientUrl, roster, pollUrl } = options;
  if (state === EMBED_STATES.CANCELLED) return cancelledLines(event).join('\n');
  if (state === EMBED_STATES.RESCHEDULING)
    return reschedulingLines(pollUrl).join('\n');

  const lines: string[] = [];
  if (TIMING_STATES.includes(state)) lines.push(timingLine(event));
  if (event.voiceChannelId) lines.push(`${SPEAKER} <#${event.voiceChannelId}>`);
  if (roster) pushBlock(lines, roster);
  if (state === EMBED_STATES.COMPLETED) {
    pushBlock(lines, attendanceLine(event));
  }
  const link = openEventLink(clientUrl, event.id);
  if (link) pushBlock(lines, link);
  return lines.join('\n');
}

/** `Attendance: 6 of 8` — reported once the event has ENDED. */
function attendanceLine(event: EmbedEventData): string {
  return event.maxAttendees
    ? `Attendance: ${event.signupCount} of ${event.maxAttendees}`
    : `Attendance: ${event.signupCount}`;
}
