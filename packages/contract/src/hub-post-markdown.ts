/**
 * The hub-post markdown subset (ROK-1868) — one definition shared by the API
 * (write validation), the web composer (same inline error before submit) and
 * both web renderers.
 *
 * Grammar (spec D14): paragraphs and line breaks; **bold** / __bold__;
 * *italic* / _italic_; ~~strike~~; `inline code`; [text](href) and
 * <https://…> autolinks whose href is http(s) or single-slash site-relative;
 * bullet (-, *, +) and numbered (1.) lists, one level deep. Anything else
 * (headings, images, tables) is plain text. Raw HTML is never allowed.
 *
 * Pure, no dependencies. The violation scanner is a single forward pass over
 * the source with precomputed "next `>` / next newline / next `)`" tables, so
 * it is O(n) on any input — no regex runs against attacker-controlled text.
 */

/** A char that may never appear in an href: space, C0 controls, DEL, C1 controls. */
function isUnsafeHrefChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code <= 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** Absolute http(s) or single-slash site-relative (`/x`, never `//x` or `/\x`). */
export function isSafeMarkdownHref(href: string): boolean {
  if ([...href].some(isUnsafeHrefChar)) return false;
  if (/^https?:\/\//.test(href)) return true;
  return href.startsWith('/') && !/^\/[/\\]/.test(href);
}

export type HubPostMarkdownViolation = 'html' | 'unsafe-link';

export const HUB_POST_MARKDOWN_MESSAGES: Record<HubPostMarkdownViolation, string> = {
  html: "Posts can't contain HTML. Use the formatting buttons instead.",
  'unsafe-link': 'Links must start with https:// or point to a page on this site.',
};

/** next[i] = index of the first `ch` at or after i (s.length when none). */
function nextIndexTable(s: string, ch: string): Int32Array {
  const next = new Int32Array(s.length + 1);
  next[s.length] = s.length;
  for (let i = s.length - 1; i >= 0; i--) next[i] = s[i] === ch ? i : (next[i + 1] ?? s.length);
  return next;
}

/** Length of the backtick run starting at i. */
function runLength(s: string, i: number, ch: string): number {
  let n = 0;
  while (s[i + n] === ch) n++;
  return n;
}

/** Index just past the code span opening at i, or -1 when the run never closes. */
function codeSpanEnd(s: string, i: number): number {
  const n = runLength(s, i, '`');
  let j = s.indexOf('`', i + n);
  while (j !== -1) {
    const m = runLength(s, j, '`');
    if (m === n) return j + m;
    j = s.indexOf('`', j + m);
  }
  return -1;
}

const AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;
const TAG_START = /[A-Za-z/!?]/;

interface Tables {
  gt: Int32Array;
  nl: Int32Array;
  paren: Int32Array;
}

/** Classify the `<` at i: a violation, or the index to resume from. */
function scanAngle(s: string, i: number, t: Tables): HubPostMarkdownViolation | number {
  const close = t.gt[i + 1] ?? s.length;
  if (close >= (t.nl[i] ?? s.length) || !TAG_START.test(s[i + 1] ?? '')) return i + 1;
  const inner = s.slice(i + 1, close);
  if (AUTOLINK.test(inner)) return isSafeMarkdownHref(inner) ? close + 1 : 'unsafe-link';
  return 'html';
}

/** Classify the `](` at i: a violation, or the index to resume from. */
function scanLinkTarget(s: string, i: number, t: Tables): HubPostMarkdownViolation | number {
  const close = t.paren[i + 2] ?? s.length;
  if (close >= s.length) return i + 2;
  const href = (s.slice(i + 2, close).trim().split(/\s/)[0] ?? '').replace(/^<|>$/g, '');
  return isSafeMarkdownHref(href) ? close + 1 : 'unsafe-link';
}

/** The first subset violation in `body`, or null. Escapes and code spans are skipped. */
export function findHubPostMarkdownViolation(body: string): HubPostMarkdownViolation | null {
  const t: Tables = { gt: nextIndexTable(body, '>'), nl: nextIndexTable(body, '\n'), paren: nextIndexTable(body, ')') };
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    let next: HubPostMarkdownViolation | number = i + 1;
    if (ch === '\\') next = i + 2;
    else if (ch === '`') {
      const end = codeSpanEnd(body, i);
      next = end === -1 ? i + runLength(body, i, '`') : end;
    } else if (ch === '<') next = scanAngle(body, i, t);
    else if (ch === ']' && body[i + 1] === '(') next = scanLinkTarget(body, i, t);
    if (typeof next === 'string') return next;
    i = next;
  }
  return null;
}

const ESCAPED = /\\([\\`*_{}[\]()#+\-.!~<>|])/g;
const MARK = '';

/** Strip inline syntax from a non-code segment; escaped chars come back literal. */
function stripInline(seg: string): string {
  const escaped: string[] = [];
  let out = seg.replace(ESCAPED, (_m, c: string) => {
    escaped.push(c);
    return MARK;
  });
  out = out
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1$2');
  let k = 0;
  return out.replace(new RegExp(MARK, 'g'), () => escaped[k++] ?? '');
}

/** Plain text for headlines and notifications: markers gone, links → their text. */
export function markdownToPlainText(body: string): string {
  let out = '';
  let seg = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\' && i + 1 < body.length) {
      seg += body.slice(i, i + 2);
      i += 2;
      continue;
    }
    const end = body[i] === '`' ? codeSpanEnd(body, i) : -1;
    if (end === -1) {
      seg += body[i];
      i++;
      continue;
    }
    const n = runLength(body, i, '`');
    out += stripInline(seg) + body.slice(i + n, end - n).trim();
    seg = '';
    i = end;
  }
  return out + stripInline(seg);
}
