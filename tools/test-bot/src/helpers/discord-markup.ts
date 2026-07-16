/**
 * Discord markup stripping utilities — mirrored from the API source of truth.
 *
 * SOURCE OF TRUTH: api/src/notifications/format-helpers.ts
 *
 * This file mirrors the production logic for use in smoke tests.
 * If the production logic changes, this file must be updated to match.
 * The two files share identical transformation rules:
 *   - formatEpoch: Unix epoch → human-readable absolute date string (tz-aware)
 *   - formatRelativeEpoch: Unix epoch → Discord `:R`-style relative delta
 *   - stripDiscordMarkup: Discord tokens → plaintext replacements
 *   - simulatePlaintextContent: title + message → cleaned plaintext
 *
 * ROK-1403: `formatEpoch` takes the recipient timezone and `stripDiscordMarkup`
 * preserves the style char so `:R` renders a relative delta — the production
 * plaintext choke point does the same before sending the DM `content`.
 */

/**
 * Format a Unix epoch (seconds) into a short, human-readable absolute date
 * string in the given IANA timezone (falls back to UTC on a bad tz).
 */
export function formatEpoch(epoch: number, timeZone?: string): string {
  const d = new Date(epoch * 1000);
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  };
  try {
    return d.toLocaleString('en-US', opts);
  } catch {
    return d.toLocaleString('en-US', { ...opts, timeZone: 'UTC' });
  }
}

/** Largest-first unit table for relative-delta rendering (seconds per unit). */
const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** Render a Unix epoch as a Discord `:R`-style relative delta. */
export function formatRelativeEpoch(epoch: number, nowMs = Date.now()): string {
  const diffSec = Math.round((epoch * 1000 - nowMs) / 1000);
  if (!Number.isFinite(diffSec)) return 'Invalid date';
  if (diffSec === 0) return 'now';
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === 'second') {
      // Round the magnitude then reapply the sign so ±x.5-unit deltas render
      // symmetrically (round-half-up on the negative side would go the wrong way).
      return rtf.format(Math.sign(diffSec) * Math.round(abs / secs), unit);
    }
  }
  return rtf.format(diffSec, 'second');
}

/** Render a single `<t:epoch:style>` token: `R` → relative, else absolute. */
function renderTimestampToken(
  epoch: number,
  style: string | undefined,
  timeZone?: string,
): string {
  return style === 'R'
    ? formatRelativeEpoch(epoch)
    : formatEpoch(epoch, timeZone);
}

/**
 * Strip Discord markup, markdown formatting, and collapse whitespace.
 * Replaces timestamps with formatted dates (absolute in `timeZone`, relative
 * for `:R`), mentions with generic labels, strips bold/italic markers, removes
 * empty parentheses, and collapses consecutive spaces.
 */
export function stripDiscordMarkup(text: string, timeZone?: string): string {
  return text
    .replace(/<t:(\d+)(?::([a-zA-Z]))?>/g, (_, epoch, style) =>
      renderTimestampToken(Number(epoch), style, timeZone),
    )
    .replace(/<#\d+>/g, '#channel')
    .replace(/<@&\d+>/g, '@role')
    .replace(/<@!?\d+>/g, '@user')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/ {2,}/g, ' ');
}

/**
 * Simulate the DM processor's plaintext content transformation.
 * Combines title and message, then strips all Discord markup (timestamps
 * rendered in `timeZone` when provided). Used in smoke tests to verify what
 * the push notification content would look like without actually sending a DM
 * (bot-to-bot DMs fail with Discord error 50007).
 */
export function simulatePlaintextContent(
  title: string,
  message: string,
  timeZone?: string,
): string {
  const raw = `${title}\n${message}`;
  return stripDiscordMarkup(raw, timeZone).trim();
}
