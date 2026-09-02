import type { SimpleEmbed, SimpleComponent } from '../helpers/messages.js';

export class SmokeAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmokeAssertionError';
  }
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

export function assertEmbedTitle(embed: SimpleEmbed, pattern: RegExp) {
  if (!embed.title || !pattern.test(embed.title)) {
    fail(`Expected embed title matching ${pattern}, got: "${embed.title}"`);
  }
}

export function assertEmbedDescription(embed: SimpleEmbed, pattern: RegExp) {
  if (!embed.description || !pattern.test(embed.description)) {
    fail(`Expected description matching ${pattern}, got: "${embed.description}"`);
  }
}

export function assertEmbedColor(embed: SimpleEmbed, expected: number) {
  if (embed.color !== expected) {
    const hex = (n: number | null) => (n !== null ? `#${n.toString(16)}` : 'null');
    fail(`Expected embed color ${hex(expected)}, got ${hex(embed.color)}`);
  }
}

export function assertEmbedHasField(embed: SimpleEmbed, name: RegExp) {
  const found = embed.fields.some((f) => name.test(f.name));
  if (!found) {
    const names = embed.fields.map((f) => f.name).join(', ');
    fail(`Expected field matching ${name}, found: [${names}]`);
  }
}

export function assertHasButton(
  components: SimpleComponent[],
  label: string,
) {
  const found = components.some(
    (c) => c.label === label || c.customId?.startsWith(label),
  );
  if (!found) {
    const labels = components.map((c) => c.label ?? c.customId).join(', ');
    fail(`Expected button "${label}", found: [${labels}]`);
  }
}

export function assertEmbedCount(
  embeds: SimpleEmbed[],
  min: number,
) {
  if (embeds.length < min) {
    fail(`Expected at least ${min} embed(s), got ${embeds.length}`);
  }
}

/** Assert that a message has a non-empty text content field (for push notifications). */
export function assertHasContent(content: string) {
  if (!content || content.trim().length === 0) {
    fail(`Expected non-empty message content, got: "${content}"`);
  }
}

/** Assert that text does not contain raw Discord tokens. */
export function assertNoDiscordTokens(text: string) {
  const patterns = [
    { pattern: /<#\d+>/, label: 'channel mention (<#...>)' },
    { pattern: /<@!?\d+>/, label: 'user mention (<@...>)' },
    { pattern: /<@&\d+>/, label: 'role mention (<@&...>)' },
    { pattern: /<t:\d+(?::[a-zA-Z])?>/, label: 'timestamp token (<t:...>)' },
  ];
  for (const { pattern, label } of patterns) {
    if (pattern.test(text)) {
      fail(`Content contains raw ${label}: "${text}"`);
    }
  }
}

/** Assert that text does not contain raw markdown formatting. */
export function assertNoMarkdown(text: string) {
  if (/\*\*.+?\*\*/.test(text)) fail(`Content contains bold markdown: "${text}"`);
  if (/~~.+?~~/.test(text)) fail(`Content contains strikethrough markdown: "${text}"`);
}

// ─── ROK-1460: reading the roster block off an embed description ────────────

const CALENDAR = '\u{1F4C6}'; // 📆
const SPEAKER = '\u{1F50A}'; // 🔊
const BOLD_RE = /\*\*[^*]+\*\*/g;
/** `**Tanks** (0/2):` — an MMO role-section header, not a member. */
const ROLE_HEADER_RE = /\*\*[^*]+\*\* \(\d+\/\d+\):/g;
/** `+3 more` — the roster collapsed past ROSTER_NAME_CAP. */
const OVERFLOW_RE = /\+\d+ more/;

/**
 * The bold roster entries in an embed description (ROK-1460 grammar).
 *
 * The `ROSTER: n signed up` header is gone and the chrome author line carries
 * no count at LIVE, so the roster BLOCK is the only count signal left. The
 * block is every description line that is not the 📆 timing line, the 🔊 voice
 * line or the trailing `[Open event ↗]` link (that link now appears only on a
 * rowless multi-group card, but the filter still guards it); MMO role-section
 * headers are dropped so only member names are counted. A struck member
 * (`~~**Bo**~~`) still counts — leaving does not remove them from a
 * cumulative roster.
 *
 * @param description - The embed description to read.
 * @returns One `**name**` string per rendered roster member, in render order.
 */
export function rosterEntries(description: string): string[] {
  return description
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((line) => !line.startsWith(CALENDAR) && !line.startsWith(SPEAKER))
    .filter((line) => !line.startsWith('[Open event'))
    .map((line) => line.replace(ROLE_HEADER_RE, ''))
    .flatMap((line) => line.match(BOLD_RE) ?? []);
}

/**
 * Whether the roster block lists exactly `count` members and nothing more.
 *
 * @param description - The embed description to read.
 * @param count - The exact number of rendered roster members expected.
 * @returns True when the block holds `count` entries and no `+N more`.
 */
export function rosterHasExactly(description: string, count: number): boolean {
  return (
    rosterEntries(description).length === count &&
    !OVERFLOW_RE.test(description)
  );
}

// ─── ROK-1460: the chrome author line ───────────────────────────────────────

/**
 * The IMMINENT author line for an exact signup count, e.g.
 * `◌ STARTS IN 60 MIN · 1 of 10`.
 *
 * ROK-1460 fix 11: the count is pinned EXACTLY. A smoke event's creator is
 * auto-signed-up, so the caller must read the real count from the API rather
 * than assume `0` — but loosening the pattern to `\d+ of` would make the
 * assertion vacuous, which is what this helper exists to prevent. Word
 * boundaries stop `1 of 10` from matching a rendered `10 of 10`.
 *
 * @param count - The exact number of active signups expected.
 * @param max - The event's `maxAttendees`.
 * @returns A RegExp matching only that count/max pair on an IMMINENT line.
 */
export function imminentAuthorPattern(count: number, max: number): RegExp {
  return new RegExp(`STARTS IN \\d+ MIN \u00b7 \\b${count} of ${max}\\b`);
}

/**
 * Whether an embed is the CANCELLED card for `title` (ROK-1460 grammar).
 *
 * Fix 12: `CANCELLED` moved off the title onto the chrome author line, and the
 * title is struck through — so a title-only predicate can never match and its
 * `pollForEmbed` just times out. Both signals are required, which is strictly
 * stronger than the pre-ROK-1460 title check it replaces.
 *
 * @param e - The embed to classify.
 * @param title - The event title the card must belong to.
 * @returns True only for that event's cancelled card.
 */
export function isCancelledCard(
  e: { author?: string | null; title?: string | null },
  title: string,
): boolean {
  return (
    !!e.author?.includes('CANCELLED') &&
    !!e.title?.startsWith('~~') &&
    !!e.title?.includes(title)
  );
}
