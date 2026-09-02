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

// ─── ROK-1466: Discord render rules ─────────────────────────────────────────

/**
 * Discord's own limits. A payload over any of these is a 400 from the API, so
 * a smoke test that reads an embed back has already proven the send succeeded —
 * these guard the near-miss case where a longer real-world value would fail.
 */
const LIMITS = {
    title: 256,
    description: 4096,
    fieldName: 256,
    fieldValue: 1024,
    fields: 25,
    embedsPerMessage: 10,
} as const;

/**
 * Tokens Discord does NOT interpret inside an embed's author name or footer
 * text. Anything here that reaches production renders as literal garbage —
 * `<t:1700000000:R>` instead of "in 2 hours", `<@123>` instead of a name.
 */
const RAW_TOKEN_RULES: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /<t:\d+(?::[a-zA-Z])?>/, label: 'timestamp token (<t:…>)' },
    { pattern: /<@!?\d+>/, label: 'user mention (<@…>)' },
    { pattern: /<@&\d+>/, label: 'role mention (<@&…>)' },
    { pattern: /<#\d+>/, label: 'channel mention (<#…>)' },
    { pattern: /\[[^\]]+\]\([^)]+\)/, label: 'masked link ([text](url))' },
];

/** Markdown Discord renders in a description but NOT in author/footer chrome. */
const MARKDOWN_RULES: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\*\*[^*]+\*\*/, label: 'bold (**…**)' },
    { pattern: /~~[^~]+~~/, label: 'strikethrough (~~…~~)' },
    { pattern: /__[^_]+__/, label: 'underline (__…__)' },
    { pattern: /`[^`]+`/, label: 'code (`…`)' },
];

/** Run a rule set over one slot, naming the slot and the offending token. */
function checkSlot(
    slot: string,
    text: string | null,
    rules: Array<{ pattern: RegExp; label: string }>,
): void {
    if (!text) return;
    for (const { pattern, label } of rules) {
        if (pattern.test(text)) {
            fail(`Embed ${slot} contains an unrendered ${label}: "${text}"`);
        }
    }
}

/** Length + emptiness rules for the embed's fields. */
function checkFields(embed: SimpleEmbed): void {
    if (embed.fields.length > LIMITS.fields) {
        fail(
            `Embed has ${embed.fields.length} fields, over Discord's ${LIMITS.fields} limit`,
        );
    }
    embed.fields.forEach((f, i) => {
        if (!f.name || f.name.trim() === '') {
            fail(`Embed field ${i} has an empty name`);
        }
        if (f.name.length > LIMITS.fieldName) {
            fail(
                `Embed field "${f.name.slice(0, 40)}" name is ${f.name.length} chars, over ${LIMITS.fieldName}`,
            );
        }
        if (!f.value || f.value.trim() === '') {
            fail(`Embed field "${f.name}" has an empty value`);
        }
        if (f.value.length > LIMITS.fieldValue) {
            fail(
                `Embed field "${f.name}" value is ${f.value.length} chars, over ${LIMITS.fieldValue}`,
            );
        }
    });
}

/**
 * Assert an embed would render correctly in a real Discord client.
 *
 * Two rule families:
 *
 *  1. **Unrendered tokens.** `author.name`, `footer.text` and `title` are plain
 *     text as far as Discord is concerned — a `<t:…>` timestamp, a mention, or
 *     a `[text](url)` masked link placed there ships to users verbatim. The
 *     description and field values ARE interpreted, so they are exempt.
 *  2. **Markdown.** Discord renders `**bold**` / `~~strike~~` in a title but
 *     NOT in the author or footer chrome. Markdown is therefore banned from
 *     author/footer only — the ROK-1460 CANCELLED card deliberately strikes
 *     its title through, and `isCancelledCard` asserts exactly that.
 *
 * Plus Discord's hard limits (title 256, description 4096, field value 1024,
 * 25 fields), which a longer real-world value would turn into a send-time 400.
 *
 * @param embed - The embed to check.
 * @throws SmokeAssertionError naming the slot and the offending token.
 */
export function assertEmbedRenderRules(embed: SimpleEmbed): void {
    checkSlot('author', embed.author, RAW_TOKEN_RULES);
    checkSlot('footer', embed.footer, RAW_TOKEN_RULES);
    checkSlot('title', embed.title, RAW_TOKEN_RULES);
    checkSlot('author', embed.author, MARKDOWN_RULES);
    checkSlot('footer', embed.footer, MARKDOWN_RULES);

    if (embed.title && embed.title.length > LIMITS.title) {
        fail(`Embed title is ${embed.title.length} chars, over ${LIMITS.title}`);
    }
    if (embed.description && embed.description.length > LIMITS.description) {
        fail(
            `Embed description is ${embed.description.length} chars, over ${LIMITS.description}`,
        );
    }
    checkFields(embed);
}

/**
 * Assert every embed on a message renders correctly, plus the per-message
 * embed cap.
 *
 * @param msg - A message read back from Discord.
 * @throws SmokeAssertionError on the first violation.
 */
export function assertMessageRenderRules(msg: {
    embeds: SimpleEmbed[];
}): void {
    if (msg.embeds.length > LIMITS.embedsPerMessage) {
        fail(
            `Message has ${msg.embeds.length} embeds, over Discord's ${LIMITS.embedsPerMessage} limit`,
        );
    }
    for (const embed of msg.embeds) assertEmbedRenderRules(embed);
}

/** Per-call escape hatch for the render-rule sweep. */
export interface RenderRuleOptions {
    /**
     * Skip the sweep for this call. Use ONLY when a test deliberately reads an
     * embed that is expected to violate a rule (e.g. asserting an error card's
     * raw payload). Never use it to quiet a failing assertion — a violation
     * means real users are seeing `<t:…>` in their Discord client.
     */
    skipRenderRules?: boolean;
}

/**
 * Gate a message a poll helper matched through the render rules.
 *
 * Wired into every helper that hands a MATCHED message to a spec
 * (`pollForEmbed`, `waitForEmbedUpdate`, `waitForDM`, `waitForMessage`) rather
 * than into `readLastMessages`, which returns up to 100 unrelated messages
 * from sibling tests.
 *
 * @param msg - The matched message.
 * @param opts - Pass `skipRenderRules: true` to bypass.
 * @returns The same message, so callers can `return sweepRenderRules(m, opts)`.
 * @throws SmokeAssertionError on the first violation.
 */
export function sweepRenderRules<T extends { embeds: SimpleEmbed[] }>(
    msg: T,
    opts?: RenderRuleOptions,
): T {
    if (opts?.skipRenderRules) return msg;
    assertMessageRenderRules(msg);
    return msg;
}
