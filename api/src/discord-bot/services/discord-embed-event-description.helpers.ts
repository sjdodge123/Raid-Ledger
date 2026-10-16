/**
 * ROK-1804 — the event's own description, as it opens an event embed body.
 *
 * Every surface that renders a scheduled event (the channel announce and its
 * lifecycle edits, the invite unfurl) opens its body with the same excerpt:
 * trimmed, block-markdown-safe, mention-safe and truncated, so the
 * `View Event` link carries the full text.
 */
import { balanceInlineMarkdown } from './discord-embed-markdown-balance.helpers';

/** The longest excerpt an embed shows before the `…` (Lead default). */
export const EVENT_DESCRIPTION_MAX = 300;

/** Discord's hard cap on an embed description. */
export const EMBED_DESCRIPTION_LIMIT = 4096;

const ELLIPSIS = '\u2026'; // …
const ZWSP = '\u200B';

/**
 * Defensive only — embeds never ping, so this is not the ping guard. Breaks
 * every mass / role mention so it cannot resolve if the text is later reused
 * outside an embed: a zero-width space (U+200B) goes after the `@` of
 * `@everyone`, `@here` and a `<@&id>` role mention.
 */
function escapeMentions(text: string): string {
  return text
    .replace(/@(everyone|here)/g, `@${ZWSP}$1`)
    .replace(/<@&/g, `<@${ZWSP}&`);
}

/**
 * Keep the excerpt's block markdown inside the excerpt: a line-leading `>>>`
 * (Discord's multi-line quote, which would swallow the timing and roster lines
 * below) becomes a single-line `>`, and runs of blank lines collapse to one.
 */
function containBlocks(text: string): string {
  return text
    .replace(/^([ \t]*)>>>/gm, '$1>')
    .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');
}

/**
 * Cut `text` to at most `max` UTF-16 units (Discord's own measure), ending in
 * `…` when cut. Iterates code points so a surrogate pair is never split.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max - ELLIPSIS.length) break;
    out += ch;
  }
  return out.trimEnd() + ELLIPSIS;
}

/**
 * The description excerpt an event embed shows, or null when there is none.
 *
 * @param description - The event's raw description (may be null/blank).
 * @param max - The longest excerpt to show, `…` included.
 * @returns The trimmed, block-contained, mention-escaped, truncated excerpt,
 *   with any inline delimiter left unmatched escaped so it cannot pair with
 *   the body below; null when the description is absent, whitespace-only, or
 *   `max` leaves no room.
 */
export function eventDescriptionExcerpt(
  description: string | null | undefined,
  max: number = EVENT_DESCRIPTION_MAX,
): string | null {
  const trimmed = description?.trim();
  if (!trimmed || max < 2) return null;
  const safe = escapeMentions(containBlocks(trimmed));
  // Escaping an unmatched delimiter adds a `\`; re-cut shorter until it fits.
  for (let budget = max; budget >= 2;) {
    const excerpt = balanceInlineMarkdown(truncate(safe, budget));
    if (excerpt.length <= max) return excerpt;
    budget -= excerpt.length - max;
  }
  return null;
}

/**
 * Prepend the description block to an already-built body, keeping the whole
 * embed description within Discord's 4096-char cap. The rest of the body
 * (timing, roster, link) wins: the excerpt shrinks, or drops, to fit.
 *
 * @param description - The event's raw description.
 * @param rest - The body lines that follow the description.
 * @returns The body, opened by the excerpt and a blank line when it fits.
 */
export function withDescription(
  description: string | null | undefined,
  rest: string,
): string {
  const separator = rest ? '\n\n' : '';
  const room = EMBED_DESCRIPTION_LIMIT - rest.length - separator.length;
  const excerpt = eventDescriptionExcerpt(
    description,
    Math.min(EVENT_DESCRIPTION_MAX, room),
  );
  return excerpt ? `${excerpt}${separator}${rest}` : rest;
}
