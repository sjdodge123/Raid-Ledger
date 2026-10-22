/**
 * `*` / `_` emphasis and `~~` strike for the inline tokenizer (ROK-1868, Codex r5/r6).
 *
 * CommonMark's delimiter-run algorithm: the scanner records each run of `*`,
 * `_` or `~` with whether it can open / close (left- / right-flanking rules),
 * and `resolveEmphasis` pairs closers with the nearest compatible opener,
 * taking 2 characters (strong) when both sides have them, else 1 (em). That is
 * what lets one run split across differently placed closers — the editor emits
 * `***both** italic*` and `**bold***italic*`.
 *
 * Deviations, all so every mark combination the editor saves renders as it was
 * typed (`markdown-roundtrip.exhaustive.test.tsx`):
 * - when both runs still have 3+ characters the inner mark is em, so
 *   `***x***` renders as strong > em;
 * - the "multiple of 3" rule is judged on the REMAINING run lengths;
 * - strike and emphasis may cross (`**~~a*b***c~~`): each pair is recorded as a
 *   range over the item list, and `nest` builds the tree, splitting a range
 *   where it crosses an enclosing one. A match only retires the unmatched
 *   delimiters of its own family (`*`/`_` or `~`) between its two runs.
 *
 * Linear scans over a bounded post (4000 chars) — no regex over the body. A
 * pair that would nest deeper than `MAX_EMPHASIS_DEPTH` is refused and its
 * delimiters stay literal, so a body like 1999 `*`, `x`, 1999 `*` cannot build
 * a thousand-deep tree that overflows the stack in `nest` or the renderer.
 */
import type { InlineNode } from './markdown-inline-parse';

/** One delimiter run still waiting to be paired. */
export interface Delim {
    kind: 'delim';
    c: string;
    count: number;
    open: boolean;
    close: boolean;
    dead: boolean;
}

/** A parsed node, or a delimiter run not yet resolved. */
export type EmphasisItem = InlineNode | Delim;

/** A matched pair: the mark covers items [from, to). `seq` orders equal spans (later = outer). */
interface Range {
    from: number;
    to: number;
    kind: 'strong' | 'em' | 's';
    seq: number;
    /** Marks this pair would stack at its deepest point: 1 + the tallest range overlapping it. */
    height: number;
}

/** Deepest em / strong / s chain one span may build; a pair past it stays literal (Codex r8). */
export const MAX_EMPHASIS_DEPTH = 6;

const isSpace = (ch: string | undefined): boolean => ch === undefined || ch.trim() === '';
const isPunct = (ch: string | undefined): boolean => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);

/** Length of the run of `c` starting at i. */
function runAt(s: string, i: number, c: string): number {
    let n = 0;
    while (s[i + n] === c) n++;
    return n;
}

/** The character at `from` walking by `step`, looking through any characters in `skip`. */
function neighbour(s: string, from: number, step: number, skip: string): string | undefined {
    let j = from;
    for (let ch = s[j]; ch !== undefined && skip.includes(ch); ch = s[j]) j += step;
    return s[j];
}

/** A `~` run: exactly `~~` opens before / closes after a non-space; any other length is literal. */
function strikeDelim(s: string, i: number): Delim {
    const n = runAt(s, i, '~');
    const ok = n === 2;
    return { kind: 'delim', c: '~', count: n, open: ok && !isSpace(s[i + 2]), close: ok && !isSpace(s[i - 1]), dead: false };
}

/**
 * The delimiter run starting at i with its flanking flags, or null when s[i] starts none.
 * With strike on, `~` runs are delimiters too, and `~` / `*` are looked through when
 * judging flanking: the editor emits `**~~a~~***b*` and `a**~~*b*c~~**`, where neither a
 * strike delimiter nor an emphasis run beside one may count as punctuation.
 */
export function emphasisDelim(s: string, i: number, strike: boolean): Delim | null {
    const c = s[i];
    if (c === '~' && strike) return strikeDelim(s, i);
    if (c !== '*' && c !== '_') return null;
    const n = runAt(s, i, c);
    const skip = strike ? '~*' : '';
    const prev = neighbour(s, i - 1, -1, skip);
    const next = neighbour(s, i + n, 1, skip);
    const left = !isSpace(next) && (!isPunct(next) || isSpace(prev) || isPunct(prev));
    const right = !isSpace(prev) && (!isPunct(prev) || isSpace(next) || isPunct(next));
    const open = c === '*' ? left : left && (!right || isPunct(prev));
    const close = c === '*' ? right : right && (!left || isPunct(next));
    return { kind: 'delim', c, count: n, open, close, dead: false };
}

/** Append, merging adjacent text so a literal run stays one string; a leftover run is text. */
export function pushNode(out: InlineNode[], item: EmphasisItem): void {
    if (item.kind === 'delim' && item.count === 0) return;
    const node: InlineNode = item.kind === 'delim' ? { kind: 'text', value: item.c.repeat(item.count) } : item;
    const last = out[out.length - 1];
    if (node.kind === 'text' && last?.kind === 'text') last.value += node.value;
    else out.push(node);
}

/** Same character, live opener; for emphasis, CommonMark's "multiple of 3" rule on the remaining lengths. */
function compatible(o: Delim, cl: Delim): boolean {
    if (o.dead || o.c !== cl.c || !o.open || o.count === 0) return false;
    if (o.c === '~') return true;
    const both = (o.open && o.close) || (cl.open && cl.close);
    return !both || (o.count + cl.count) % 3 !== 0 || (o.count % 3 === 0 && cl.count % 3 === 0);
}

/** Index of the nearest opener before ci that can pair with the closer at ci, or -1. */
function findOpener(items: EmphasisItem[], ci: number, cl: Delim): number {
    for (let j = ci - 1; j >= 0; j--) {
        const it = items[j];
        if (it?.kind === 'delim' && compatible(it, cl)) return j;
    }
    return -1;
}

/** Pair opener oi with closer ci: consume characters, record the range, retire same-family runs between. */
function applyMatch(items: EmphasisItem[], ranges: Range[], [oi, ci]: [number, number], [o, cl]: [Delim, Delim], height: number): void {
    const strike = o.c === '~';
    const use = strike ? 2 : o.count >= 3 && cl.count >= 3 ? 1 : o.count >= 2 && cl.count >= 2 ? 2 : 1;
    o.count -= use;
    cl.count -= use;
    ranges.push({ from: oi + 1, to: ci, kind: strike ? 's' : use === 2 ? 'strong' : 'em', seq: ranges.length, height });
    for (let j = oi + 1; j < ci; j++) {
        const it = items[j];
        if (it?.kind === 'delim' && (it.c === '~') === strike) it.dead = true;
    }
}

/** The height a pair over items [oi + 1, ci) would have (conservative: any overlap counts as inside). */
function heightOf(ranges: Range[], oi: number, ci: number): number {
    let tallest = 0;
    for (const r of ranges) if (r.from < ci && r.to > oi + 1) tallest = Math.max(tallest, r.height);
    return tallest + 1;
}

const outerFirst = (a: Range, b: Range): number => a.from - b.from || b.to - a.to || b.seq - a.seq;

/** Split `rest` around range r: the parts inside it, and the parts at or after its end. */
function splitAround(r: Range, rest: Range[]): [Range[], Range[]] {
    const inside: Range[] = [];
    const after: Range[] = [];
    for (const x of rest) {
        if (x.from >= r.to) { after.push(x); continue; }
        inside.push({ ...x, to: Math.min(x.to, r.to) });
        if (x.to > r.to) after.push({ ...x, from: r.to });
    }
    return [inside, after.sort(outerFirst)];
}

/** Build the node tree for items [from, to) under `ranges` (all starting at or after `from`). */
function nest(items: EmphasisItem[], ranges: Range[], from: number, to: number): InlineNode[] {
    const out: InlineNode[] = [];
    let pending = ranges.filter((r) => r.from < r.to).sort(outerFirst);
    let i = from;
    while (i < to) {
        const r = pending[0];
        const item = items[i];
        if (r === undefined || r.from > i) {
            if (item) pushNode(out, item);
            i++;
            continue;
        }
        const [inside, after] = splitAround(r, pending.slice(1));
        pushNode(out, { kind: r.kind, children: nest(items, inside, r.from, r.to) });
        pending = after;
        i = r.to;
    }
    return out;
}

/**
 * Pair the delimiter runs in `items` into em / strong / s nodes; unpaired runs
 * become literal text.
 * @param items - nodes and delimiter runs in source order (mutated)
 * @returns the resolved node list, adjacent text merged
 */
export function resolveEmphasis(items: EmphasisItem[]): InlineNode[] {
    const ranges: Range[] = [];
    let ci = 0;
    while (ci < items.length) {
        const cl = items[ci];
        const live = cl?.kind === 'delim' && cl.close && !cl.dead && cl.count > 0;
        const oi = live ? findOpener(items, ci, cl) : -1;
        const o = items[oi];
        if (cl?.kind !== 'delim' || o?.kind !== 'delim') { ci++; continue; }
        const height = heightOf(ranges, oi, ci);
        // Past the cap the closer stops closing; its characters render literal.
        if (height > MAX_EMPHASIS_DEPTH) { cl.close = false; ci++; continue; }
        applyMatch(items, ranges, [oi, ci], [o, cl], height);
        // A closer with characters left is retried in place.
        if (cl.count === 0) ci++;
    }
    return nest(items, ranges, 0, items.length);
}
