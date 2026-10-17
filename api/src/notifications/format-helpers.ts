/**
 * Shared formatting utilities for Discord notification content.
 *
 * These functions transform Discord-specific markup (timestamps, mentions,
 * markdown) into human-readable plaintext for mobile push notification
 * previews (ROK-756, ROK-822, ROK-918).
 *
 * ROK-1403 — the DM plaintext `content` (= phone push preview) and the web
 * in-app list are the two surfaces where Discord `<t:epoch:style>` markup does
 * NOT render viewer-local (only the embed does). `formatEpoch` therefore takes
 * the recipient's timezone (resolved at DM-send time in the processor), and
 * `stripDiscordMarkup` preserves the style char so `:R` (relative) renders a
 * real delta ("in 2 hours") instead of collapsing to a duplicate absolute
 * string. Rendering `<t:>` markup correctly HERE is what makes the bug
 * non-recurring: any current or future notification type may store `<t:>`
 * markup and it will render correctly on every surface.
 *
 * SOURCE OF TRUTH: Any mirrored copies in test tooling (e.g.
 * tools/test-bot/src/helpers/discord-markup.ts) must stay in sync with this
 * file — including the timezone + relative-delta semantics below.
 */

/** Maximum length for mobile push notification content. */
export const MAX_CONTENT_LENGTH = 150;

/**
 * Format a Unix epoch (seconds) into a short, human-readable absolute date
 * string in the given IANA timezone (recipient pref → guild default → 'UTC').
 *
 * Omitting `timeZone` renders in the server process TZ — only acceptable in
 * tests; production callers thread the recipient's tz through. A corrupt /
 * non-IANA `timeZone` must not abort the DM fan-out, so a RangeError falls
 * back to a correctly-labeled UTC rendering (mirrors the guard in
 * event-delay.helpers.ts::buildDelayMessage).
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

/**
 * Render a Unix epoch (seconds) as a Discord `:R`-style relative delta
 * ("in 2 hours", "3 days ago"), picking the largest unit that fits the
 * distance from `nowMs`. Mirrors Discord's viewer-side relative rendering so
 * the DM plaintext / web surfaces no longer collapse `:R` to a duplicate
 * absolute string.
 */
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
 * Build a plaintext content string for Discord push notification previews.
 * Combines title and message, strips all Discord markup (timestamps rendered
 * in the recipient's `timeZone`), and truncates to MAX_CONTENT_LENGTH with an
 * ellipsis if needed.
 */
export function buildPlaintextContent(
  title: string,
  message: string,
  timeZone?: string,
): string {
  const safeTitle = sanitizeValue(title);
  const safeMessage = sanitizeValue(message);
  const cleaned = stripDiscordMarkup(
    `${safeTitle}\n${safeMessage}`,
    timeZone,
  ).trim();
  if (cleaned.length <= MAX_CONTENT_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_CONTENT_LENGTH - 3) + '...';
}

/** Safely convert a value to a string, guarding against null/undefined/objects. */
function sanitizeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}
