/**
 * The inline Markdown tokenizer shared by `MarkdownText` and `MarkdownBlock`
 * (ROK-1868 D15). Pure: text in, a node tree out — never HTML.
 *
 * Grammar: **bold** / __bold__, *italic* / _italic_, ***both***, ~~strike~~
 * (opt-in), `code`, [label](href), <https://…> autolinks (opt-in) and `\`
 * escapes of ASCII punctuation. Marks nest (bold inside a link, a link inside
 * bold) up to MAX_DEPTH. A link whose href fails the contract's
 * `isSafeMarkdownHref` is NOT a link — its source stays literal text. `![`
 * (image syntax) is literal. Anything unmatched (`**x`) is literal.
 *
 * A hand-written forward scanner, no regex over the body, so a crafted post
 * cannot trigger catastrophic backtracking.
 */
import { isSafeMarkdownHref } from '@raid-ledger/contract';

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
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

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

/** Index of the delimiter run closing an `n`-long run of `c` opened before `from`, or -1. */
function findClose(s: string, from: number, c: string, n: number): number {
    let j = from;
    while (j < s.length) {
        const ch = s[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '`') {
            const end = codeSpanEnd(s, j);
            if (end !== -1) { j = end; continue; }
        }
        if (ch !== c) { j++; continue; }
        const m = runLength(s, j, c);
        const at = m === n ? j : m === 3 && n < 3 ? j + 3 - n : -1;
        if (at > from && !isSpace(s[at - 1]) && !(c === '_' && isWordChar(s[j + m]))) return at;
        j += m;
    }
    return -1;
}

/** Wrap `inner` in the mark that an `n`-long run produces. */
function markNode(n: number, inner: InlineNode[]): InlineNode {
    if (n === 1) return { kind: 'em', children: inner };
    if (n === 2) return { kind: 'strong', children: inner };
    return { kind: 'strong', children: [{ kind: 'em', children: inner }] };
}

/** `*` / `_` emphasis (1–3 long) or `~~` strike opening at i. */
function matchMark(ctx: Ctx, i: number, c: string): Hit | null {
    const { s } = ctx;
    const n = c === '~' ? 2 : Math.min(3, runLength(s, i, c));
    if (c === '~' && runLength(s, i, c) !== 2) return null;
    if (isSpace(s[i + n]) || (c === '_' && isWordChar(s[i - 1]))) return null;
    const close = findClose(s, i + n, c, n);
    if (close === -1) return null;
    const inner = parseNested(ctx, s.slice(i + n, close), ctx.inLink);
    return { nodes: [c === '~' ? { kind: 's', children: inner } : markNode(n, inner)], end: close + n };
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

/** `[label](href)` at i — only when the href is safe. */
function matchLink(ctx: Ctx, i: number): Hit | null {
    const { s } = ctx;
    const close = closeBracket(s, i);
    if (close <= i + 1 || s[close + 1] !== '(') return null;
    const paren = s.indexOf(')', close + 2);
    const href = paren === -1 ? '' : s.slice(close + 2, paren);
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
    if (ch === '*' || ch === '_' || (ch === '~' && opts.strike)) return matchMark(ctx, i, ch);
    return null;
}

/** Append, merging adjacent text so a literal run stays one string. */
function push(out: InlineNode[], node: InlineNode): void {
    const last = out[out.length - 1];
    if (node.kind === 'text' && last?.kind === 'text') last.value += node.value;
    else out.push(node);
}

function parseNested(ctx: Ctx, s: string, inLink: boolean): InlineNode[] {
    return parseWith({ s, opts: ctx.opts, depth: ctx.depth + 1, inLink });
}

function parseWith(ctx: Ctx): InlineNode[] {
    const out: InlineNode[] = [];
    let i = 0;
    while (i < ctx.s.length) {
        const hit = matchAt(ctx, i);
        if (hit) hit.nodes.forEach((n) => push(out, n));
        else push(out, { kind: 'text', value: ctx.s[i] ?? '' });
        i = hit ? hit.end : i + 1;
    }
    return out;
}

/** Parse one line of inline Markdown into a node tree (see the file header). */
export function parseInline(text: string, opts: InlineOptions): InlineNode[] {
    return parseWith({ s: text, opts, depth: 0, inLink: false });
}
