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

/**
 * A trailing `.`, `)`, `"` … is prose, not the URL. A trailing `*`, `_`, `~`
 * or `|` run stays in it (Discord's autolink keeps it: `…/file__` is the
 * target) unless it closes an open delimiter — see `CloserTest` (ROK-1806).
 */
const BARE_URL = String.raw`https?://[^\s<]*[^\s<.,:;"')\]]`;

const ATOM = new RegExp(`${ANGLE}|${LINK_TARGET}|${BARE_URL}`, 'y');

const URL_ONLY = new RegExp(BARE_URL, 'y');

const SCHEME = /^https?:\/\//;

/** Characters that start an inline delimiter run (`**`, `__`, `~~`, `||`). */
const RUN_CHAR = /[*_~|]/;

/**
 * ROK-1806 — whether a delimiter run starting at `text[index]` closes a span
 * opened earlier in the text (outside atoms). When it does, a bare URL ends
 * before the run, so `**Read https://x.y/guide**` keeps its `**` pair.
 */
export type CloserTest = (index: number) => boolean;

/** Length of the bare URL `url` once trailing prose punctuation is dropped. */
function trimmedUrlLength(url: string): number {
  URL_ONLY.lastIndex = 0;
  return URL_ONLY.exec(url)?.[0].length ?? 0;
}

/**
 * Where the bare URL at `text[i]` (`len` long) ends, given open closers. A
 * mixed run (`_**`, `__~~`, `_||`) is split into same-character sub-runs, each
 * tested as a closer in order, so `file_**` still yields its `**` (Codex r2 P2).
 * A `\`-escaped character is skipped, as `step` does, so an escaped `\*` never
 * starts a closer run (Codex r3 P2).
 */
function urlLength(
  text: string,
  i: number,
  len: number,
  closes: CloserTest,
): number {
  const start = i + (SCHEME.exec(text.slice(i, i + len))?.[0].length ?? len);
  let prev = '';
  for (let j = start; j < i + len; j++) {
    const ch = text[j] ?? '';
    if (ch === '\\') {
      j++;
      prev = '';
      continue;
    }
    if (RUN_CHAR.test(ch) && prev !== ch && closes(j)) {
      return trimmedUrlLength(text.slice(i, j));
    }
    prev = ch;
  }
  return len;
}

/**
 * Length of the atomic (never-markdown) chunk starting at `text[i]`.
 *
 * @param text - The excerpt being scanned.
 * @param i - The UTF-16 index to test.
 * @param closes - When given, a bare URL ends before the first delimiter run
 *   inside it that closes an open span (ROK-1806); without it, the URL keeps
 *   its whole run (truncation's measure).
 * @returns The chunk's UTF-16 length, or 0 when no chunk starts at `i`.
 */
export function atomLength(
  text: string,
  i: number,
  closes?: CloserTest,
): number {
  ATOM.lastIndex = i;
  const match = ATOM.exec(text);
  if (!match) return 0;
  const len = match[0].length;
  if (!closes || !SCHEME.test(match[0])) return len;
  return urlLength(text, i, len, closes);
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
