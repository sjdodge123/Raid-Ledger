/**
 * ROK-1460 (slice B) — scheduled-event chrome.
 *
 * The event family has EIGHT lifecycle states; the shared chrome has FIVE.
 * This module is the only place that collapses one onto the other, writes the
 * state-carrying author line, and builds the two links an event embed may
 * carry. See `planning-artifacts/specs/ROK-1460.md` §Files, §Grammar, §Links.
 */
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import type { EmbedState as ChromeState } from '../embeds/embed-chrome.helpers';
import { formatDurationMs } from '../utils/format-duration';
import type { EmbedEventData } from './discord-embed.factory';

/** Author-line glyphs, spelled out so a mojibake diff stays readable. */
const OPEN = '\u25B8'; // ▸
const DOTTED = '\u25CC'; // ◌
const SOLID = '\u25CF'; // ●
const SQUARE = '\u25A0'; // ■
const CROSS = '\u2715'; // ✕
const CYCLE = '\u21BB'; // ↻
const SEP = '\u00B7'; // ·
const ARROW = '\u2197'; // ↗

/** 8 lifecycle states onto the 5 chrome states that own the palette. */
const CHROME_STATES: Record<EmbedState, ChromeState> = {
  [EMBED_STATES.POSTED]: 'announcing',
  [EMBED_STATES.FILLING]: 'announcing',
  [EMBED_STATES.FULL]: 'announcing',
  [EMBED_STATES.IMMINENT]: 'needs_you',
  [EMBED_STATES.RESCHEDULING]: 'needs_you',
  [EMBED_STATES.LIVE]: 'live',
  [EMBED_STATES.COMPLETED]: 'done',
  [EMBED_STATES.CANCELLED]: 'cancelled',
};

/**
 * Map a lifecycle state onto the chrome state that owns its colour.
 *
 * @param state - One of the eight `EMBED_STATES` values.
 * @returns The chrome state understood by `colorForState`.
 */
export function lifecycleToChromeState(state: EmbedState): ChromeState {
  return CHROME_STATES[state] ?? 'announcing';
}

/** `3 of 8` when a cap exists, else the bare count. */
function countPair(event: EmbedEventData): string {
  return event.maxAttendees
    ? `${event.signupCount} of ${event.maxAttendees}`
    : `${event.signupCount}`;
}

/** Whole minutes between `now` and `iso`, never negative. */
function minutesFrom(iso: string, now: number): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
}

/** `started 20 min ago` — minutes while short, compact duration after an hour. */
function elapsedPhrase(event: EmbedEventData, now: number): string {
  const elapsedMs = Math.max(0, now - new Date(event.startTime).getTime());
  const label =
    elapsedMs < 3_600_000
      ? `${Math.floor(elapsedMs / 60_000)} min`
      : formatDurationMs(elapsedMs);
  return `started ${label} ago`;
}

/** The scheduled length of the event, e.g. `2h 14m`. */
function scheduledDuration(event: EmbedEventData): string {
  return formatDurationMs(
    new Date(event.endTime).getTime() - new Date(event.startTime).getTime(),
  );
}

/**
 * The state-carrying author line for a scheduled event (spec §Grammar).
 *
 * @param state - The lifecycle state being rendered.
 * @param event - The event whose counts and times the line reports.
 * @returns e.g. `▸ OPEN · 3 of 8 signed up`. Never the bare community name.
 */
export function authorLineFor(
  state: EmbedState,
  event: EmbedEventData,
): string {
  const now = Date.now();
  switch (state) {
    case EMBED_STATES.FILLING:
      return `${DOTTED} FILLING ${SEP} ${countPair(event)}`;
    case EMBED_STATES.FULL:
      return `${SOLID} FULL ${SEP} ${countPair(event)}`;
    case EMBED_STATES.IMMINENT:
      return `${DOTTED} STARTS IN ${minutesFrom(event.startTime, now)} MIN ${SEP} ${countPair(event)}`;
    case EMBED_STATES.LIVE:
      return `${OPEN} LIVE ${SEP} ${elapsedPhrase(event, now)}`;
    case EMBED_STATES.COMPLETED:
      return `${SQUARE} ENDED ${SEP} ${scheduledDuration(event)}`;
    case EMBED_STATES.CANCELLED:
      return `${CROSS} CANCELLED`;
    case EMBED_STATES.RESCHEDULING:
      return `${CYCLE} RESCHEDULING ${SEP} poll open`;
    default:
      return `${OPEN} OPEN ${SEP} ${countPair(event)} signed up`;
  }
}

/**
 * The game detail page the embed title links to (id-based; there is no slug).
 *
 * @param clientUrl - Configured web origin, if any.
 * @param gameId - The game's numeric id, if the projection carries one.
 * @returns `${clientUrl}/games/${gameId}`, or null when either input is absent.
 */
export function gameDetailUrl(
  clientUrl: string | null | undefined,
  gameId: number | null | undefined,
): string | null {
  if (!clientUrl || gameId === null || gameId === undefined) return null;
  return `${clientUrl}/games/${gameId}`;
}

/**
 * A markdown masked link with the label's `]` escaped.
 *
 * @param label - Link text; `]` is escaped so it cannot break out of the mask.
 * @param url - Destination.
 * @returns `[label](url)`.
 */
export function maskedLink(label: string, url: string): string {
  return `[${label.replace(/]/g, '\\]')}](${url})`;
}

/**
 * The trailing masked link to the event page.
 *
 * @param clientUrl - Configured web origin, if any.
 * @param eventId - The event's id.
 * @param label - Link text; `]` is escaped so it cannot break out of the mask.
 * @returns `[Open event ↗](url)`, or null without a client URL.
 */
export function openEventLink(
  clientUrl: string | null | undefined,
  eventId: number,
  label: string = `Open event ${ARROW}`,
): string | null {
  if (!clientUrl) return null;
  return maskedLink(label, `${clientUrl}/events/${eventId}`);
}
