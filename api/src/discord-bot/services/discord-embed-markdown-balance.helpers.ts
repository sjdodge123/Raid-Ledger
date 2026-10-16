/**
 * ROK-1804 — keep a description excerpt's inline markdown inside the excerpt.
 *
 * Truncation can cut a closing delimiter off (`~~struck …` loses its `~~`), and
 * the next matching delimiter in the embed body — a departed roster member's
 * `~~` — then closes it, formatting everything in between. Any delimiter left
 * unmatched is backslash-escaped, so it renders as the literal character it
 * already was and can no longer pair with text outside the excerpt. Matched
 * pairs, code spans, existing escapes and atomic chunks (emoji, mentions,
 * timestamps, URLs, link targets — see `atomLength`) are left untouched.
 */
import { atomLength } from './discord-embed-markdown-atoms.helpers';

type Delimiter = '**' | '__' | '~~' | '||' | '*' | '_';

/** Longest first, so `**` is never read as two `*`. */
const DELIMITERS: readonly Delimiter[] = ['**', '__', '~~', '||', '*', '_'];

/** Single `*` / `_` only open before, and close after, a non-space. */
const FLANKED: ReadonlySet<Delimiter> = new Set<Delimiter>(['*', '_']);

/** Open delimiter → index of its chunk in the output. */
type OpenSet = Map<Delimiter, number>;

function escapeEach(chunk: string): string {
  return [...chunk].map((ch) => `\\${ch}`).join('');
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch);
}

/**
 * Whether `d` at `text[i]` can open / close a span. A single `*` / `_` opens
 * before, and closes after, a non-space; a single `_` inside a word
 * (`snake_case`) is never emphasis in Discord (its `\b_…_\b` rule), so it is
 * neither — and is left as written (ROK-1806).
 */
function flanking(
  text: string,
  i: number,
  d: Delimiter,
): { canOpen: boolean; canClose: boolean } {
  if (!FLANKED.has(d)) return { canOpen: true, canClose: true };
  const before = text[i - 1];
  const after = text[i + d.length];
  const intraword = d === '_';
  return {
    canOpen: !isSpace(after) && !(intraword && isWord(before)),
    canClose: !isSpace(before) && !(intraword && isWord(after)),
  };
}

function delimiterAt(text: string, i: number): Delimiter | null {
  return DELIMITERS.find((d) => text.startsWith(d, i)) ?? null;
}

function backtickRun(text: string, i: number): number {
  let j = i;
  while (text[j] === '`') j++;
  return j - i;
}

/** End index of the code span opened by `n` backticks at `start`, or null. */
function codeSpanEnd(text: string, start: number, n: number): number | null {
  const runs = /`+/g;
  runs.lastIndex = start + n;
  for (let m = runs.exec(text); m; m = runs.exec(text)) {
    if (m[0].length === n) return m.index + n;
  }
  return null;
}

/** A closed code span is copied verbatim; an unclosed opener is escaped. */
function codeStep(text: string, i: number, out: string[]): number {
  const n = backtickRun(text, i);
  const end = codeSpanEnd(text, i, n);
  if (end === null) {
    out.push(escapeEach(text.slice(i, i + n)));
    return i + n;
  }
  out.push(text.slice(i, end));
  return end;
}

function delimiterStep(
  text: string,
  i: number,
  d: Delimiter,
  out: string[],
  open: OpenSet,
): void {
  out.push(d);
  const at = out.length - 1;
  const openAt = open.get(d);
  const { canOpen, canClose } = flanking(text, i, d);
  if (openAt !== undefined && canClose) open.delete(d);
  else if (openAt === undefined && canOpen) open.set(d, at);
}

function step(text: string, i: number, out: string[], open: OpenSet): number {
  const ch = text[i] ?? '';
  if (ch === '\\') {
    out.push(text.slice(i, i + 2));
    return i + 2;
  }
  if (ch === '`') return codeStep(text, i, out);
  const atom = atomLength(text, i);
  if (atom > 0) {
    out.push(text.slice(i, i + atom));
    return i + atom;
  }
  const d = delimiterAt(text, i);
  if (d === null) {
    out.push(ch);
    return i + 1;
  }
  delimiterStep(text, i, d, out, open);
  return i + d.length;
}

/**
 * Escape every inline delimiter (`**`, `__`, `~~`, `||`, `*`, `_`, and code
 * backticks/fences) that has no partner within `text`.
 *
 * @param text - A (possibly truncated) markdown excerpt.
 * @returns `text` unchanged when balanced; otherwise with each unmatched
 *   delimiter backslash-escaped, character by character.
 */
export function balanceInlineMarkdown(text: string): string {
  const out: string[] = [];
  const open: OpenSet = new Map();
  let i = 0;
  while (i < text.length) i = step(text, i, out, open);
  for (const at of open.values()) {
    const chunk = out[at];
    if (chunk !== undefined) out[at] = escapeEach(chunk);
  }
  return out.join('');
}
