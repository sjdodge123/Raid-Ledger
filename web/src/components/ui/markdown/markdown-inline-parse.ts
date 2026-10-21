/**
 * The inline Markdown tokenizer shared by `MarkdownText` and `MarkdownBlock`
 * (ROK-1868 D15). Pure: text in, a node tree out — never HTML.
 *
 * Grammar: **bold** / __bold__, *italic* / _italic_, ***both*** (CommonMark
 * delimiter runs, so `***a** b*` and `**a***b*` pair — see markdown-emphasis), ~~strike~~
 * (opt-in), `code`, [label](href "optional title"), <https://…> autolinks (opt-in) and `\`
 * escapes of ASCII punctuation. Marks nest (bold inside a link, a link inside
 * bold) up to MAX_DEPTH. A link whose href fails the contract's
 * `isSafeMarkdownHref` is NOT a link — its source stays literal text. `![`
 * (image syntax) is literal. Anything unmatched (`**x`) is literal.
 *
 * A hand-written forward scanner, no regex over the body, so a crafted post
 * cannot trigger catastrophic backtracking.
 */
import { isSafeMarkdownHref } from '@raid-ledger/contract';
import { emphasisDelim, resolveEmphasis, type EmphasisItem } from './markdown-emphasis';

/** One node of the parsed inline tree. */
export type InlineNode =
    | { kind: 'text'; value: string }
    | { kind: 'code'; value: string }
    | { kind: 'strong' | 'em' | 's'; children: InlineNode[] }
    | { kind: 'link'; href: string; children: InlineNode[] };

/** Which optional constructs are on. `MarkdownText` turns both off. */
export interface InlineOptions {
    strike: boolean;
    autolink: boolean;
}

interface Ctx {
    s: string;
    opts: InlineOptions;
    depth: number;
    inLink: boolean;
}

interface Hit {
    nodes: InlineNode[];
    end: number;
}

const MAX_DEPTH = 4;
const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

const isSpace = (ch: string | undefined): boolean => ch === undefined || ch.trim() === '';

/** Length of the run of `ch` starting at i. */
function runLength(s: string, i: number, ch: string): number {
    let n = 0;
    while (s[i + n] === ch) n++;
    return n;
}

/** Index just past the code span opening at i, or -1 when its backtick run never closes. */
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

/** Index of the `~~` run closing a strike opened before `from`, or -1. */
function findStrikeClose(s: string, from: number): number {
    let j = from;
    while (j < s.length) {
        const ch = s[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '`') {
            const end = codeSpanEnd(s, j);
            if (end !== -1) { j = end; continue; }
        }
        if (ch !== '~') { j++; continue; }
        const m = runLength(s, j, '~');
        if (m === 2 && j > from && !isSpace(s[j - 1])) return j;
        j += m;
    }
    return -1;
}

/** `~~strike~~` opening at i (`*` / `_` emphasis is resolved by `markdown-emphasis`). */
function matchStrike(ctx: Ctx, i: number): Hit | null {
    const { s } = ctx;
    if (runLength(s, i, '~') !== 2 || isSpace(s[i + 2])) return null;
    const close = findStrikeClose(s, i + 2);
    if (close === -1) return null;
    const inner = parseNested(ctx, s.slice(i + 2, close), ctx.inLink);
    return { nodes: [{ kind: 's', children: inner }], end: close + 2 };
}

/** Index of the `]` matching the `[` at i (escapes skipped), or -1. */
function closeBracket(s: string, i: number): number {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
        const ch = s[j];
        if (ch === '\\') j++;
        else if (ch === '[') depth++;
        else if (ch === ']' && --depth === 0) return j;
    }
    return -1;
}

/** Index of the `)` closing a link destination opened at i (balanced, escapes skipped), or -1. */
function closeParen(s: string, i: number): number {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
        const ch = s[j];
        if (ch === '\\') j++;
        else if (ch === '(') depth++;
        else if (ch === ')' && depth-- === 0) return j;
    }
    return -1;
}

/**
 * The destination of a `(…)` link body: an optional `"title"`, `'title'` or
 * `(title)` after whitespace (TipTap emits one for a pasted titled link) is
 * dropped, then `\(` / `\)` are unescaped. `\S+\s+` cannot backtrack.
 */
function linkDestination(raw: string): string {
    const titled = /^(\S+)\s+(?:"[^"]*"|'[^']*'|\([^()]*\))\s*$/.exec(raw);
    return (titled?.[1] ?? raw).replace(/\\([()])/g, '$1');
}

/** `[label](href)` at i — only when the href is safe; balanced `(…)` and escaped `\(` / `\)` stay in the href. */
function matchLink(ctx: Ctx, i: number): Hit | null {
    const { s } = ctx;
    const close = closeBracket(s, i);
    if (close <= i + 1 || s[close + 1] !== '(') return null;
    const paren = closeParen(s, close + 2);
    const href = paren === -1 ? '' : linkDestination(s.slice(close + 2, paren));
    if (href === '' || !isSafeMarkdownHref(href)) return null;
    return { nodes: [{ kind: 'link', href, children: parseNested(ctx, s.slice(i + 1, close), true) }], end: paren + 1 };
}

/** `<https://…>` at i — absolute http(s) only. */
function matchAutolink(ctx: Ctx, i: number): Hit | null {
    const gt = ctx.s.indexOf('>', i + 1);
    const href = gt === -1 ? '' : ctx.s.slice(i + 1, gt);
    if (!/^https?:\/\//.test(href) || !isSafeMarkdownHref(href)) return null;
    return { nodes: [{ kind: 'link', href, children: [{ kind: 'text', value: href }] }], end: gt + 1 };
}

/** `\x` escape or a `code` span at i. */
function matchLiteral(s: string, i: number): Hit | null {
    const ch = s[i] ?? '';
    const next = s[i + 1];
    if (ch === '\\' && next !== undefined && ESCAPABLE.includes(next)) {
        return { nodes: [{ kind: 'text', value: next }], end: i + 2 };
    }
    if (ch !== '`') return null;
    const end = codeSpanEnd(s, i);
    if (end === -1) return null;
    const n = runLength(s, i, '`');
    const raw = s.slice(i + n, end - n);
    const value = raw.length > 2 && raw.startsWith(' ') && raw.endsWith(' ') ? raw.slice(1, -1) : raw;
    return { nodes: [{ kind: 'code', value }], end };
}

/** The construct starting at i, or null when s[i] is plain text. */
function matchAt(ctx: Ctx, i: number): Hit | null {
    const { s, opts } = ctx;
    const ch = s[i];
    const literal = matchLiteral(s, i);
    if (literal || ctx.depth >= MAX_DEPTH) return literal;
    if (ch === '!' && s[i + 1] === '[') return { nodes: [{ kind: 'text', value: '![' }], end: i + 2 };
    if (ch === '[' && !ctx.inLink) return matchLink(ctx, i);
    if (ch === '<' && opts.autolink && !ctx.inLink) return matchAutolink(ctx, i);
    if (ch === '~' && opts.strike) return matchStrike(ctx, i);
    return null;
}

function parseNested(ctx: Ctx, s: string, inLink: boolean): InlineNode[] {
    return parseWith({ s, opts: ctx.opts, depth: ctx.depth + 1, inLink });
}

/** Scan into nodes + emphasis delimiter runs, then pair the runs (`resolveEmphasis`). */
function parseWith(ctx: Ctx): InlineNode[] {
    const items: EmphasisItem[] = [];
    let i = 0;
    while (i < ctx.s.length) {
        const delim = ctx.depth < MAX_DEPTH ? emphasisDelim(ctx.s, i, ctx.opts.strike ? '~' : '') : null;
        if (delim) { items.push(delim); i += delim.count; continue; }
        const hit = matchAt(ctx, i);
        if (hit) items.push(...hit.nodes);
        else items.push({ kind: 'text', value: ctx.s[i] ?? '' });
        i = hit ? hit.end : i + 1;
    }
    return resolveEmphasis(items);
}

/** Parse one line of inline Markdown into a node tree (see the file header). */
export function parseInline(text: string, opts: InlineOptions): InlineNode[] {
    return parseWith({ s: text, opts, depth: 0, inLink: false });
}
