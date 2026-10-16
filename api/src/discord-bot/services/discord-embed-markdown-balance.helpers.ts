/**
 * ROK-1804 — keep a description excerpt's inline markdown inside the excerpt.
 *
 * Truncation can cut a closing delimiter off (`~~struck …` loses its `~~`), and
 * the next matching delimiter in the embed body — a departed roster member's
 * `~~` — then closes it, formatting everything in between. Any delimiter left
 * unmatched is backslash-escaped, so it renders as the literal character it
 * already was and can no longer pair with text outside the excerpt. Matched
 * pairs, code spans and existing escapes are left untouched.
 */

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
  const flanked = FLANKED.has(d);
  const canOpen = !flanked || !isSpace(text[i + d.length]);
  const canClose = !flanked || !isSpace(text[i - 1]);
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
