/**
 * Line tokenizer for the hub-post Discord relay excerpt (ROK-1868 §2.5 step 1).
 *
 * Turns one line of hub-post markdown into tokens the excerpt renderer can
 * budget: cuttable `text`, indivisible `atom`s (escapes, code spans, links,
 * Discord escapes), list `marker`s, and matched `open`/`close` delimiters.
 * Single forward pass; the only regex runs on a bounded `<…>` candidate.
 */
import { isSafeMarkdownHref, markdownToPlainText } from '@raid-ledger/contract';

export type ExcerptToken =
  | { kind: 'text'; raw: string }
  | { kind: 'atom'; src: string; visible: number }
  | { kind: 'marker'; src: string }
  | { kind: 'open'; src: string }
  | { kind: 'close'; src: string }
  | { kind: 'break' };

interface RunToken {
  kind: 'run';
  ch: string;
  len: number;
  canOpen: boolean;
  canClose: boolean;
}

type RawToken = ExcerptToken | RunToken;

interface Ctx {
  line: string;
  clientUrl: string;
  out: RawToken[];
  /** Set once a forward search for the char found nothing — later searches would too. */
  missing: Set<string>;
}

const AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Escape the Discord-only inline syntax the subset never uses: `||`, `__`, `<`. */
export function escapeDiscordText(raw: string): string {
  return raw
    .split('||')
    .join('\\|\\|')
    .split('__')
    .join('\\_\\_')
    .split('<')
    .join('\\<');
}

function atom(src: string, visible: number): ExcerptToken {
  return { kind: 'atom', src, visible };
}

function pushText(out: RawToken[], s: string): void {
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.raw += s;
  else out.push({ kind: 'text', raw: s });
}

function runLength(s: string, i: number, ch: string): number {
  let n = 0;
  while (s[i + n] === ch) n++;
  return n;
}

/** First index of `ch` at or after `from`, memoising misses (keeps the pass linear). */
function find(ctx: Ctx, ch: string, from: number): number {
  if (ctx.missing.has(ch)) return -1;
  const at = ctx.line.indexOf(ch, from);
  if (at === -1) ctx.missing.add(ch);
  return at;
}

/** Length of a flat list marker (`- `, `* `, `+ `, `12. `) at line start, else 0. */
function listMarkerLength(line: string): number {
  const c = line[0];
  if ((c === '-' || c === '*' || c === '+') && line[1] === ' ') return 2;
  let n = 0;
  while (n < 9 && (line[n] ?? '') >= '0' && (line[n] ?? '') <= '9') n++;
  return n > 0 && line[n] === '.' && line[n + 1] === ' ' ? n + 2 : 0;
}

/** Markers and the line-start Discord escapes (`#`, `>`, `-#`, ```` ``` ````). */
function lineStart(ctx: Ctx): number {
  const { line, out } = ctx;
  const marker = listMarkerLength(line);
  if (marker > 0) {
    out.push({ kind: 'marker', src: line.slice(0, marker) });
    return marker;
  }
  if (line.startsWith('```')) return (out.push(atom('\\`\\`\\`', 3)), 3);
  if (line.startsWith('-#')) return (out.push(atom('\\-', 1)), 1);
  const c = line[0];
  if (c === '#' || c === '>') return (out.push(atom(`\\${c}`, 1)), 1);
  return 0;
}

/** A backtick run: a whole code span (atomic) or escaped literal backticks. */
function codeSpan(ctx: Ctx, i: number): number {
  const n = runLength(ctx.line, i, '`');
  let j = ctx.line.indexOf('`', i + n);
  while (j !== -1) {
    const m = runLength(ctx.line, j, '`');
    if (m === n) {
      ctx.out.push(atom(ctx.line.slice(i, j + m), Math.max(1, j - i - n)));
      return j + m;
    }
    j = ctx.line.indexOf('`', j + m);
  }
  ctx.out.push(atom('\\`'.repeat(n), n));
  return i + n;
}

/** The first whitespace-separated part of a link destination, `<…>` stripped. */
function parseHref(dest: string): string {
  const first = dest.trim().split(/\s/)[0] ?? '';
  return first.startsWith('<') && first.endsWith('>')
    ? first.slice(1, -1)
    : first;
}

/** Discord cannot resolve app-relative paths; prefix the client URL. */
function absolutise(href: string, clientUrl: string): string {
  if (!href.startsWith('/')) return href;
  let base = clientUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}${href}`;
}

/** `[text](href)` → one atom; an unsafe href keeps only the escaped text. */
function link(ctx: Ctx, i: number): number {
  const j = find(ctx, ']', i + 1);
  const k = j === -1 || ctx.line[j + 1] !== '(' ? -1 : find(ctx, ')', j + 2);
  if (k === -1) {
    pushText(ctx.out, '[');
    return i + 1;
  }
  const text = ctx.line.slice(i + 1, j);
  const href = parseHref(ctx.line.slice(j + 2, k));
  const plain = markdownToPlainText(text);
  const src = isSafeMarkdownHref(href)
    ? `[${escapeDiscordText(text)}](${absolutise(href, ctx.clientUrl)})`
    : escapeDiscordText(plain);
  ctx.out.push(atom(src, Math.max(1, plain.length)));
  return k + 1;
}

/** `<scheme:…>` autolink → atom; anything else → an escaped `<`. */
function angle(ctx: Ctx, i: number): number {
  const close = find(ctx, '>', i + 1);
  const inner = close === -1 ? '' : ctx.line.slice(i + 1, close);
  if (close !== -1 && AUTOLINK.test(inner)) {
    const src = isSafeMarkdownHref(inner)
      ? `<${inner}>`
      : escapeDiscordText(inner);
    ctx.out.push(atom(src, inner.length));
    return close + 1;
  }
  ctx.out.push(atom('\\<', 1));
  return i + 1;
}

const isWord = (c: string): boolean => c !== '' && WORD_CHAR.test(c);
const isBlank = (c: string): boolean => c === '' || /\s/.test(c);

/** A run of `*`, `_` or `~`: a delimiter candidate, or literal text. */
function delimiterRun(ctx: Ctx, i: number): number {
  const { line, out } = ctx;
  const ch = line[i] ?? '';
  const n = runLength(line, i, ch);
  const prev = line[i - 1] ?? '';
  const next = line[i + n] ?? '';
  const under = ch === '_';
  if (under && isWord(prev) && isWord(next))
    pushText(out, line.slice(i, i + n));
  else if (ch === '~' && n !== 2) out.push(atom('\\~'.repeat(n), n));
  else {
    const canOpen = !isBlank(next) && !(under && isWord(prev));
    const canClose = !isBlank(prev) && !(under && isWord(next));
    out.push({ kind: 'run', ch, len: n, canOpen, canClose });
  }
  return i + n;
}

/** One inline step from `i`; returns the index to resume from. */
function step(ctx: Ctx, i: number): number {
  const ch = ctx.line[i] ?? '';
  if (ch === '\\' && i + 1 < ctx.line.length) {
    const width = (ctx.line.codePointAt(i + 1) ?? 0) > 0xffff ? 3 : 2;
    ctx.out.push(atom(ctx.line.slice(i, i + width), 1));
    return i + width;
  }
  if (ch === '`') return codeSpan(ctx, i);
  if (ch === '[') return link(ctx, i);
  if (ch === '<') return angle(ctx, i);
  if (ch === '*' || ch === '_' || ch === '~') return delimiterRun(ctx, i);
  if (ch === '!' && ctx.line[i + 1] === '[') ctx.out.push(atom('\\!', 1));
  else pushText(ctx.out, ch);
  return i + 1;
}

/** Discord reads `__x__` as underline; a matched `__` pair is emitted as bold `**`. */
function discordDelimiter(ch: string, len: number): string {
  return ch === '_' && len === 2 ? '**' : ch.repeat(len);
}

/** Pair delimiter runs within the line; unmatched runs become escaped literals. */
function resolveRuns(raw: RawToken[]): ExcerptToken[] {
  const out: ExcerptToken[] = [];
  const stack: { ch: string; len: number; at: number }[] = [];
  for (const t of raw) {
    if (t.kind !== 'run') {
      out.push(t);
      continue;
    }
    let r = t.len;
    for (
      let top = stack[stack.length - 1];
      t.canClose && top?.ch === t.ch && top.len <= r;
      top = stack[stack.length - 1]
    ) {
      stack.pop();
      r -= top.len;
      out.push({ kind: 'close', src: discordDelimiter(t.ch, top.len) });
    }
    if (r > 0 && r <= 3 && t.canOpen) {
      for (const len of r === 3 ? [1, 2] : [r]) {
        stack.push({ ch: t.ch, len, at: out.length });
        out.push({ kind: 'open', src: discordDelimiter(t.ch, len) });
      }
      r = 0;
    }
    if (r > 0) out.push(atom(`\\${t.ch}`.repeat(r), r));
  }
  for (const s of stack) out[s.at] = atom(`\\${s.ch}`.repeat(s.len), s.len);
  return out;
}

/** Tokenise a whole body, line by line, with `break` tokens between lines. */
export function tokenizeExcerpt(
  body: string,
  clientUrl: string,
): ExcerptToken[] {
  const tokens: ExcerptToken[] = [];
  body.split('\n').forEach((line, index) => {
    if (index > 0) tokens.push({ kind: 'break' });
    const ctx: Ctx = { line, clientUrl, out: [], missing: new Set() };
    let i = lineStart(ctx);
    while (i < line.length) i = step(ctx, i);
    tokens.push(...resolveRuns(ctx.out));
  });
  return tokens;
}
