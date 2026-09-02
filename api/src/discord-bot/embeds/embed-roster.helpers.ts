/**
 * ROK-1459 (slice A) — shared roster formatter.
 *
 * Renders display names, never mentions: a channel embed listing a roster must
 * not ping six people every time it re-syncs. Mention-shaped input is defanged
 * rather than passed through, and markdown markers are escaped so a name like
 * `snake_case` cannot break the surrounding bold — nor a name shaped like
 * `[click me](https://evil.example)` render as a masked link (ROK-1460).
 */

/** Names rendered before the roster collapses into `+N more`. */
export const ROSTER_NAME_CAP = 6;

const MENTION_RE = /<@[!&]?(\d+)>/g;
const ANGLE_BRACKETS_RE = /[<>]/g;
/**
 * Markdown markers Discord honours inside an embed description.
 *
 * ROK-1460: `[` `]` `(` `)` are in the set because a display name is
 * user-controlled and `[label](url)` renders as a masked LINK — a name shaped
 * like one would turn every re-synced roster into a clickable link.
 */
const MARKDOWN_RE = /([\\*_~`|[\]()])/g;

/** Strip mention syntax, then escape the markdown markers Discord honours. */
function sanitizeName(name: string): string {
  return name
    .replace(MENTION_RE, '$1')
    .replace(ANGLE_BRACKETS_RE, '')
    .replace(MARKDOWN_RE, '\\$1');
}

/**
 * One roster member plus the decorations that must survive sanitisation.
 *
 * `name` is escaped; `prefix` / `suffix` are TRUSTED emoji strings emitted
 * verbatim (ROK-1460 §Roster, operator decision D8).
 */
export interface RosterEntry {
  name: string;
  /** Rendered before the bold name, e.g. `⏳ ⏰ `. */
  prefix?: string;
  /** Rendered after the bold name, e.g. ` 🛡️`. */
  suffix?: string;
  /** Wraps the bold name in `~~` — the signup left. */
  struck?: boolean;
}

/** Render one entry: `{prefix}**{name}**{suffix}`, struck when it left. */
function formatEntry(entry: RosterEntry): string {
  const bold = `**${sanitizeName(entry.name)}**`;
  return `${entry.prefix ?? ''}${entry.struck ? `~~${bold}~~` : bold}${entry.suffix ?? ''}`;
}

/** Widen a plain name into the structured form. */
function toEntry(item: string | RosterEntry): RosterEntry {
  return typeof item === 'string' ? { name: item } : item;
}

/**
 * Render a roster as bold display names joined with ` · `.
 *
 * @param names - Display names or `RosterEntry` records, in render order.
 * @param cap - Names to render before collapsing the rest into `+N more`.
 * @returns e.g. `**Ana** · **Bo** +4 more`.
 *
 * An empty roster returns `''`. Discord REJECTS an empty string as a field
 * value, so a caller putting this straight into `addFields` must substitute its
 * own fallback (e.g. `formatRoster(names) || 'None yet'`).
 */
export function formatRoster(
  names: readonly string[] | readonly RosterEntry[],
  cap: number = ROSTER_NAME_CAP,
): string {
  if (names.length === 0) return '';

  const entries = (names as readonly (string | RosterEntry)[]).map(toEntry);
  const shown = entries.slice(0, cap).map(formatEntry).join(' · ');
  const overflow = entries.length - cap;

  return overflow > 0 ? `${shown} +${overflow} more` : shown;
}
