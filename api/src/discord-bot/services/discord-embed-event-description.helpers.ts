/**
 * ROK-1804 — the event's own description, as it opens an event embed body.
 *
 * Every surface that renders a scheduled event (the channel announce and its
 * lifecycle edits, the invite unfurl) shows the same excerpt: trimmed, mention-
 * safe and truncated, so the `View Event` link carries the full text.
 */

/** The longest excerpt an embed shows before the `…` (Lead default). */
export const EVENT_DESCRIPTION_MAX = 300;

/** Discord's hard cap on an embed description. */
export const EMBED_DESCRIPTION_LIMIT = 4096;

const ELLIPSIS = '…'; // …
const ZWSP = '​';

/**
 * Break every mass / role mention so it can never resolve, even if the text
 * is later reused outside an embed. `@everyone` → `@​everyone`, and
 * `<@&123>` → `<@​&123>` (a zero-width space after the `@`).
 */
function escapeMentions(text: string): string {
  return text
    .replace(/@(everyone|here)/g, `@${ZWSP}$1`)
    .replace(/<@&/g, `<@${ZWSP}&`);
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
 * @returns The trimmed, mention-escaped, truncated excerpt; null when the
 *   description is absent, whitespace-only, or `max` leaves no room.
 */
export function eventDescriptionExcerpt(
  description: string | null | undefined,
  max: number = EVENT_DESCRIPTION_MAX,
): string | null {
  const trimmed = description?.trim();
  if (!trimmed || max < 2) return null;
  return truncate(escapeMentions(trimmed), max);
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
