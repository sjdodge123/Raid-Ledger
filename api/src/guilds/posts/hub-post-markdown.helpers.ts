/**
 * Pure hub-post markdown helpers for the API (ROK-1868 §2.4, §2.5).
 *
 * - `normalizeHubPostBody` — the write-path normaliser run after validation.
 * - `markdownExcerpt` — the Discord relay excerpt: budgets VISIBLE characters,
 *   never cuts inside a link or code span, closes every open delimiter before
 *   the `…`, absolutises app-relative links and escapes Discord-only syntax.
 *
 * No DB, no Nest. No regex runs against the whole user body except two
 * single-quantifier, linear ones (`\r\n?`, `\n{3,}`).
 */
import {
  type ExcerptToken,
  escapeDiscordText,
  tokenizeExcerpt,
} from './hub-post-markdown.tokenize';

/** Hard bound on the excerpt's source length (Discord's description cap is 4096). */
export const EXCERPT_MAX_SOURCE = 1024;

export interface MarkdownExcerptOptions {
  /** Visible-character budget (the relay uses 300). */
  visible: number;
  /** Absolute client origin, e.g. `https://raid.example`, for app-relative links. */
  clientUrl: string;
}

/** One normalised char: line separators → `\n`, C0 controls (bar tab/LF) and zero-width chars dropped. */
function normalizeChar(ch: string): string {
  const c = ch.codePointAt(0) ?? 0;
  if (c === 0x2028 || c === 0x2029) return '\n';
  if (c === 0x09 || c === 0x0a) return ch;
  if (c < 0x20) return '';
  if ((c >= 0x200b && c <= 0x200d) || c === 0xfeff) return '';
  return ch;
}

/**
 * Normalise a validated hub-post body (§2.4): CRLF/CR → LF, U+2028/2029 → LF,
 * strip C0 controls except `\n`/`\t` and the zero-width chars U+200B–U+200D,
 * U+FEFF, then collapse 3+ consecutive newlines to 2. Trailing whitespace is
 * kept (a markdown hard break). Only ever shrinks or keeps the length.
 */
export function normalizeHubPostBody(body: string): string {
  let out = '';
  for (const ch of body.replace(/\r\n?/g, '\n')) out += normalizeChar(ch);
  return out.replace(/\n{3,}/g, '\n\n');
}

interface Piece {
  kind: ExcerptToken['kind'];
  str: string;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function visibleOf(t: ExcerptToken): number {
  if (t.kind === 'text') return t.raw.length;
  if (t.kind === 'atom') return t.visible;
  return t.kind === 'break' ? 1 : 0;
}

function pieceOf(t: ExcerptToken): Piece {
  if (t.kind === 'text') return { kind: 'text', str: escapeDiscordText(t.raw) };
  if (t.kind === 'break') return { kind: 'break', str: '\n' };
  return { kind: t.kind, str: t.src };
}

/** The longest prefix of `raw` within `remaining`: up to the last whitespace, else whole graphemes. */
function cutText(raw: string, remaining: number): string {
  if (remaining <= 0) return '';
  for (let i = Math.min(remaining, raw.length - 1); i >= 0; i--) {
    if (/\s/.test(raw[i] ?? '')) return raw.slice(0, i);
  }
  let end = 0;
  for (const { segment } of GRAPHEMES.segment(raw)) {
    if (end + segment.length > remaining) break;
    end += segment.length;
  }
  return raw.slice(0, end);
}

/** Drop trailing whitespace, line breaks, bare list markers and empty openers. */
function trimTail(out: Piece[], stack: string[]): void {
  for (let last = out[out.length - 1]; last; last = out[out.length - 1]) {
    if (last.kind === 'text') {
      last.str = last.str.trimEnd();
      if (last.str) return;
    } else if (last.kind === 'open') stack.pop();
    else if (last.kind !== 'break' && last.kind !== 'marker') return;
    out.pop();
  }
}

function join(out: Piece[]): string {
  return out.map((p) => p.str).join('');
}

/** Render tokens within a visible budget; `…` (outside the closers) only when something was cut. */
function renderExcerpt(tokens: ExcerptToken[], visible: number): string {
  const out: Piece[] = [];
  const stack: string[] = [];
  let used = 0;
  for (const t of tokens) {
    const v = visibleOf(t);
    if (used + v > visible) {
      const part = t.kind === 'text' ? cutText(t.raw, visible - used) : '';
      if (part) out.push({ kind: 'text', str: escapeDiscordText(part) });
      trimTail(out, stack);
      return `${join(out)}${[...stack].reverse().join('')}…`;
    }
    out.push(pieceOf(t));
    used += v;
    if (t.kind === 'open') stack.push(t.src);
    if (t.kind === 'close') stack.pop();
  }
  return join(out);
}

/**
 * The Discord-safe opening of a hub post (§2.5): at most `visible` visible
 * characters, every construct either whole or absent, open formatting closed,
 * ≤ `EXCERPT_MAX_SOURCE` source chars (re-rendered with a smaller budget when
 * escapes or long URLs push it past).
 */
export function markdownExcerpt(
  body: string,
  options: MarkdownExcerptOptions,
): string {
  const tokens = tokenizeExcerpt(body, options.clientUrl);
  let visible = Math.max(0, Math.floor(options.visible));
  let out = renderExcerpt(tokens, visible);
  while (out.length > EXCERPT_MAX_SOURCE && visible > 0) {
    visible = Math.floor(visible * 0.75);
    out = renderExcerpt(tokens, visible);
  }
  return out;
}
