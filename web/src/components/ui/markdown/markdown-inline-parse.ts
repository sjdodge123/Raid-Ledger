/**
 * The inline Markdown tokenizer shared by `MarkdownText` and `MarkdownBlock`
 * (ROK-1868 D15). Pure: text in, a node tree out — never HTML.
 *
 * Grammar: **bold** / __bold__, *italic* / _italic_, ***both*** (CommonMark
 * delimiter runs, so `***a** b*` and `**a***b*` pair — see markdown-emphasis), ~~strike~~
 * (opt-in, resolved with emphasis so the two may cross), `code`, [label](href "optional title"),
 * <https://…> autolinks (opt-in) and `\` escapes of ASCII punctuation. Marks nest (bold inside a link, a link inside
 * bold) up to MAX_DEPTH. A link whose href fails the contract's
 * `isSafeMarkdownHref` is NOT a link — its source stays literal text. `![`
 * (image syntax) is literal. Anything unmatched (`**x`) is literal.
 *
 * A hand-written forward scanner, no regex over the body, so a crafted post
 * cannot trigger catastrophic backtracking.
 */
import { isSafeMarkdownHref } from '@raid-ledger/contract';
import { autolinkAt } from './markdown-autolink';
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
    /** When set (top level only), every link the scan forms records its label's `[from, to)` here. */
    labels?: Array<[number, number]>;
    /** When set (top level only), the index of every `[` the scan prints as literal text. */
    literalBrackets?: number[];
}

interface Hit {
    nodes: InlineNode[];
    end: number;
}

const MAX_DEPTH = 4;
const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

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
 * dropped, the optional `<…>` wrapper is stripped (as the contract scanner and the
 * API relay parser do — Codex r12), then `\(` / `\)` are unescaped. `\S+\s+` cannot backtrack.
 */
function linkDestination(raw: string): string {
    const titled = /^(\S+)\s+(?:"[^"]*"|'[^']*'|\([^()]*\))\s*$/.exec(raw);
    const dest = titled?.[1] ?? raw;
    const bare = /^<([^<>\n]*)>$/.exec(dest)?.[1] ?? dest;
    return bare.replace(/\\([()])/g, '$1');
}

/** `[label](href)` at i — only when the href is safe; balanced `(…)` and escaped `\(` / `\)` stay in the href. */
function matchLink(ctx: Ctx, i: number): Hit | null {
    const { s } = ctx;
    const close = closeBracket(s, i);
    if (close <= i + 1 || s[close + 1] !== '(') return null;
    const paren = closeParen(s, close + 2);
    const href = paren === -1 ? '' : linkDestination(s.slice(close + 2, paren));
    if (href === '' || !isSafeMarkdownHref(href)) return null;
    ctx.labels?.push([i + 1, close]);
    return { nodes: [{ kind: 'link', href, children: parseNested(ctx, s.slice(i + 1, close), true) }], end: paren + 1 };
}

/** `<https://…>` at i — absolute http(s) only, the shared grammar (`markdown-autolink.ts`). */
function matchAutolink(ctx: Ctx, i: number): Hit | null {
    const hit = autolinkAt(ctx.s, i);
    if (hit === null || !isSafeMarkdownHref(hit.href)) return null;
    return { nodes: [{ kind: 'link', href: hit.href, children: [{ kind: 'text', value: hit.href }] }], end: hit.end };
}

/** `\x` escape or a `code` span at i. */
function matchLiteral(s: string, i: number): Hit | null {
    const ch = s[i] ?? '';
    const next = s[i + 1];
    if (ch === '\\' && next !== undefined && ESCAPABLE.includes(next)) {
        return { nodes: [{ kind: 'text', value: next }], end: i + 2 };
    }
    if (ch !== '`') return null;
    const n = runLength(s, i, '`');
    const end = codeSpanEnd(s, i);
    // An unmatched run is literal as a whole (CommonMark) — not re-scanned from its second backtick.
    if (end === -1) return { nodes: [{ kind: 'text', value: '`'.repeat(n) }], end: i + n };
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
        const delim = ctx.depth < MAX_DEPTH ? emphasisDelim(ctx.s, i, ctx.opts.strike) : null;
        if (delim) { items.push(delim); i += delim.count; continue; }
        const hit = matchAt(ctx, i);
        if (hit) items.push(...hit.nodes);
        else items.push({ kind: 'text', value: ctx.s[i] ?? '' });
        if (!hit && ctx.s[i] === '[') ctx.literalBrackets?.push(i);
        i = hit ? hit.end : i + 1;
    }
    return resolveEmphasis(items);
}

/** Parse one line of inline Markdown into a node tree (see the file header). */
export function parseInline(text: string, opts: InlineOptions): InlineNode[] {
    return parseWith({ s: text, opts, depth: 0, inLink: false });
}

/** The options `MarkdownBlock` reads a hub post with. */
const READER_OPTS: InlineOptions = { strike: true, autolink: true };

/**
 * Whether the stretch `[from, to)` of `s` sits inside the label of a link the reader actually forms
 * (r14b review) — the label's `]` must be followed by a `(…)` that closes on a safe destination, so
 * `[a <https://…> b](/p` (no `)`) is not a label and its autolink stays a link. Decided by the reader's
 * own scan of the stretch's line, so load, save and `MarkdownBlock` cannot disagree.
 * @param s - the markdown (one line on load, the whole body on save)
 * @param from - the stretch's first index
 * @param to - the index just past it
 * @returns true when a reader link's label covers the stretch
 */
export function insideLinkLabel(s: string, from: number, to: number): boolean {
    const start = s.lastIndexOf('\n', from - 1) + 1;
    const stop = s.indexOf('\n', to);
    const labels: Array<[number, number]> = [];
    parseWith({ s: s.slice(start, stop === -1 ? s.length : stop), opts: READER_OPTS, depth: 0, inLink: false, labels });
    return labels.some(([a, b]: [number, number]): boolean => from - start >= a && to - start <= b);
}

/**
 * `s` with a `\\` before every `[` the reader prints as literal text (r14b review). marked's link grammar
 * is more lenient than the reader's (`[a](/p(x)` links `/p(x` there), so the load path escapes the
 * brackets the reader never opens a link with, and marked cannot form a link `MarkdownBlock` does not show.
 * @param s - one line, as the load path parses it
 * @returns the line with those brackets escaped
 */
export function escapeLiteralBrackets(s: string): string {
    const at: number[] = [];
    parseWith({ s, opts: READER_OPTS, depth: 0, inLink: false, literalBrackets: at });
    let out = '';
    let from = 0;
    for (const i of at) {
        out += `${s.slice(from, i)}\\`;
        from = i;
    }
    return out + s.slice(from);
}
