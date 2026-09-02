/**
 * ROK-1459 (slice A) — shared roster formatter.
 *
 * Renders display names, never mentions: a channel embed listing a roster must
 * not ping six people every time it re-syncs. Mention-shaped input is defanged
 * rather than passed through, and markdown markers are escaped so a name like
 * `snake_case` cannot break the surrounding bold.
 */

/** Names rendered before the roster collapses into `+N more`. */
export const ROSTER_NAME_CAP = 6;

const MENTION_RE = /<@[!&]?(\d+)>/g;
const ANGLE_BRACKETS_RE = /[<>]/g;
const MARKDOWN_RE = /([\\*_~`|])/g;

/** Strip mention syntax, then escape the markdown markers Discord honours. */
function sanitizeName(name: string): string {
  return name
    .replace(MENTION_RE, '$1')
    .replace(ANGLE_BRACKETS_RE, '')
    .replace(MARKDOWN_RE, '\\$1');
}

/**
 * Render a roster as bold display names joined with ` · `.
 *
 * @param names - Display names, in the order they should appear.
 * @param cap - Names to render before collapsing the rest into `+N more`.
 * @returns e.g. `**Ana** · **Bo** +4 more`.
 *
 * An empty roster returns `''`. Discord REJECTS an empty string as a field
 * value, so a caller putting this straight into `addFields` must substitute its
 * own fallback (e.g. `formatRoster(names) || 'None yet'`).
 */
export function formatRoster(
  names: readonly string[],
  cap: number = ROSTER_NAME_CAP,
): string {
  if (names.length === 0) return '';

  const shown = names
    .slice(0, cap)
    .map((name) => `**${sanitizeName(name)}**`)
    .join(' · ');
  const overflow = names.length - cap;

  return overflow > 0 ? `${shown} +${overflow} more` : shown;
}
