import { Fragment, type ReactNode } from 'react';

/**
 * Render Discord `<t:epoch:style>` timestamp markup inside a notification
 * message as browser-local `<time>` elements (ROK-1403).
 *
 * Discord renders `<t:>` markup viewer-local only inside a Discord embed; the
 * web in-app notification list and dashboard activity feed render the stored
 * `message` verbatim, so without this parser they show raw `<t:...>` tokens.
 * We localize each token to the browser's own timezone (`Intl`, no explicit
 * timeZone) — the `:R` (relative) style becomes a live delta ("in 2 hours"),
 * every other style an absolute date. Non-timestamp text is passed through
 * untouched (no markdown/mention handling — out of scope), and nothing is ever
 * rendered as raw HTML, so there is no injection surface.
 *
 * Mirrors the server-side plaintext semantics in
 * api/src/notifications/format-helpers.ts.
 */

const TOKEN_RE = /<t:(\d+)(?::([a-zA-Z]))?>/g;

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** Absolute date/time in the browser's local timezone + locale. */
function formatAbsolute(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Largest Date value that `Date` / `toISOString()` accept without throwing. */
const MAX_DATE_MS = 8.64e15;

/** Discord `:R`-style relative delta ("in 2 hours", "3 days ago", "now"). */
function formatRelative(epoch: number, nowMs: number): string {
  const diffSec = Math.round((epoch * 1000 - nowMs) / 1000);
  if (!Number.isFinite(diffSec)) return 'Invalid date';
  if (diffSec === 0) return 'now';
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === 'second') {
      // Round the magnitude then reapply the sign so ±x.5-unit deltas render
      // symmetrically (round-half-up on the negative side would go the wrong way).
      return rtf.format(Math.sign(diffSec) * Math.round(abs / secs), unit);
    }
  }
  return rtf.format(diffSec, 'second');
}

/**
 * Parse `text`, replacing every `<t:epoch:style>` token with a localized
 * `<time>` element. Returns the original string when no token is present.
 */
export function renderDiscordTimestamps(
  text: string,
  nowMs: number = Date.now(),
): ReactNode {
  if (!text.includes('<t:')) return text;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Fragment key={key++}>{text.slice(lastIndex, match.index)}</Fragment>,
      );
    }
    const epoch = Number(match[1]);
    const ms = epoch * 1000;
    const label =
      match[2] === 'R' ? formatRelative(epoch, nowMs) : formatAbsolute(epoch);
    // An out-of-range/non-finite epoch (e.g. a `<t:9999999999999>` token pasted
    // into an event title) makes new Date(ms).toISOString() throw RangeError,
    // which would unmount the notifications panel. Only set the machine-readable
    // dateTime attribute when the epoch is a renderable Date; the label already
    // degrades to "Invalid Date" via toLocaleString.
    const inRange = Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS;
    parts.push(
      <time
        key={key++}
        {...(inRange ? { dateTime: new Date(ms).toISOString() } : {})}
      >
        {label}
      </time>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<Fragment key={key}>{text.slice(lastIndex)}</Fragment>);
  }
  return parts;
}
