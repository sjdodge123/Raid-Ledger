/**
 * ROK-1804 (Codex r3 P2) — spans of a description excerpt that are never
 * markdown: Discord's `<…>` tokens (custom/animated emoji, user/role/channel
 * mentions, timestamps, slash commands, `<url>`), a markdown link's `](url)`
 * target, and bare `http(s)://` URLs. The delimiter balancer copies them
 * verbatim (escaping `raid_ready` breaks the emoji or link) and truncation
 * never cuts inside one.
 */

const ANGLE = String.raw`<(?:a?:\w+:\d+|@[!&\u200B]*\d+|#\d+|t:-?\d+(?::[tTdDfFR])?|/[\w -]+:\d+|https?://[^\s<>]+)>`;

const LINK_TARGET = String.raw`\]\((?:<[^\s<>]+>|[^\s()]+)\)`;

/** A trailing `.`, `)`, `**`, `~~` … is prose or markdown, not the URL. */
const BARE_URL = String.raw`https?://[^\s<]*[^\s<.,:;"')\]*_~|]`;

const ATOM = new RegExp(`${ANGLE}|${LINK_TARGET}|${BARE_URL}`, 'y');

/**
 * Length of the atomic (never-markdown) chunk starting at `text[i]`.
 *
 * @param text - The excerpt being scanned.
 * @param i - The UTF-16 index to test.
 * @returns The chunk's UTF-16 length, or 0 when no chunk starts at `i`.
 */
export function atomLength(text: string, i: number): number {
  ATOM.lastIndex = i;
  const match = ATOM.exec(text);
  return match ? match[0].length : 0;
}

/** A bare URL whose run of non-space characters reaches the end of `text`. */
const URL_TAIL = /https?:\/\/[^\s<]*$/;

/**
 * ROK-1806 — whether `text` ends inside a bare URL's run. `BARE_URL` stops
 * before a trailing `_` or `)`, but Discord's autolink keeps going through any
 * non-space character, so a `…` appended directly would join the link.
 *
 * @param text - The kept part of a truncated excerpt.
 * @returns True when the last non-space run is (or ends) a bare URL.
 */
export function endsInBareUrl(text: string): boolean {
  return URL_TAIL.test(text);
}
