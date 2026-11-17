/**
 * ROK-2208 §5.7 — pure helpers for an event thread's Discord post: the dated
 * title the operator approved on the ROK-2226 mockup (2026-11-16,
 * "Molten Core — Sat 22 Nov"), the 2226 root text with its event link made
 * absolute, and the read-only test (item 5: a closed thread never posts).
 *
 * The server has no viewer zone, so the date is read in the community
 * default timezone (`DEFAULT_TIMEZONE`, the zone the Discord event embeds and
 * the weekly digest use); unset or invalid ⇒ UTC.
 */
import { DISCORD_THREAD_NAME_MAX } from '../../../discord-bot/lfg-board/lfg-board.constants';
import { safeTimeZone } from '../../../notifications/weekly-digest-schedule.helpers';
import { cutAtBoundary } from './hub-forum-discord-content';

const DASH = ' — ';
const FALLBACK_TITLE = 'Event';
const ABSOLUTE = /^https?:\/\//i;

/** "Sat 22 Nov" for `start` in `timeZone` (unset/bogus ⇒ UTC). */
export function eventPostDate(start: Date, timeZone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimeZone(timeZone),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/** "<event title> — <short date>", ≤100 chars; a long title is cut, never the date. */
export function eventPostTitle(
  title: string,
  start: Date,
  timeZone: string | null,
): string {
  const suffix = `${DASH}${eventPostDate(start, timeZone)}`;
  const room = DISCORD_THREAD_NAME_MAX - suffix.length;
  const head = cutAtBoundary(title.trim(), room);
  return `${head.length > 0 ? head : FALLBACK_TITLE}${suffix}`;
}

/** The 2226 root text with its root-relative links on the client URL. */
export function eventPostBody(body: string, clientUrl: string): string {
  if (!ABSOLUTE.test(clientUrl)) return body;
  const base = clientUrl.replace(/\/+$/, '');
  return body.replace(/\]\(\//g, `](${base}/`);
}

/** The ROK-2226 write state of an event thread. */
export interface EventThreadWriteState {
  writeClosesAt: Date | null;
  eventDetachedAt: Date | null;
}

/** Item 5: a detached thread, or one past `write_closes_at`, is read-only. */
export function eventThreadReadOnly(
  t: EventThreadWriteState,
  now: Date,
): boolean {
  if (t.eventDetachedAt !== null) return true;
  return t.writeClosesAt !== null && t.writeClosesAt <= now;
}
