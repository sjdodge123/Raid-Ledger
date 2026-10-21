/**
 * `*` / `_` emphasis for the inline tokenizer (ROK-1868, Codex r5).
 *
 * CommonMark's delimiter-run algorithm: the scanner records each run of `*`
 * or `_` with whether it can open / close (left- / right-flanking rules), and
 * `resolveEmphasis` pairs closers with the nearest compatible opener, taking
 * 2 characters (strong) when both sides have them, else 1 (em). That is what
 * lets one run split across differently placed closers — the editor emits
 * `***both** italic*` and `**bold***italic*`, which a "find the matching run"
 * scanner cannot pair. One deviation: when both runs still have 3+ characters
 * the inner mark is em, so `***x***` renders as strong > em (as before).
 *
 * Linear scans over a bounded post (4000 chars) — no regex over the body.
 */
import type { InlineNode } from './markdown-inline-parse';

/** One delimiter run still waiting to be paired. */
export interface Delim {
    kind: 'delim';
    c: string;
    count: number;
    orig: number;
    open: boolean;
    close: boolean;
}

/** A parsed node, or a delimiter run not yet resolved. */
export type EmphasisItem = InlineNode | Delim;

const isSpace = (ch: string | undefined): boolean => ch === undefined || ch.trim() === '';
const isPunct = (ch: string | undefined): boolean => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);

/** The character at `from` walking by `step`, looking through any characters in `skip`. */
function neighbour(s: string, from: number, step: number, skip: string): string | undefined {
    let j = from;
    for (let ch = s[j]; ch !== undefined && skip.includes(ch); ch = s[j]) j += step;
    return s[j];
}

/**
 * The `*` / `_` run starting at i with its flanking flags, or null when s[i] is neither.
 * `skip` (`~*` when strike is on) is looked through when judging flanking: the editor
 * emits `**~~a~~***b*` and `a**~~*b*c~~**`, where neither a strike delimiter nor an
 * emphasis run nested inside one may count as punctuation (Codex r5/r6).
 */
export function emphasisDelim(s: string, i: number, skip: string): Delim | null {
    const c = s[i];
    if (c !== '*' && c !== '_') return null;
    let n = 0;
    while (s[i + n] === c) n++;
    const prev = neighbour(s, i - 1, -1, skip);
    const next = neighbour(s, i + n, 1, skip);
    const left = !isSpace(next) && (!isPunct(next) || isSpace(prev) || isPunct(prev));
    const right = !isSpace(prev) && (!isPunct(prev) || isSpace(next) || isPunct(next));
    const open = c === '*' ? left : left && (!right || isPunct(prev));
    const close = c === '*' ? right : right && (!left || isPunct(next));
    return { kind: 'delim', c, count: n, orig: n, open, close };
}

/** Append, merging adjacent text so a literal run stays one string; a leftover run is text. */
export function pushNode(out: InlineNode[], item: EmphasisItem): void {
    const node: InlineNode = item.kind === 'delim' ? { kind: 'text', value: item.c.repeat(item.count) } : item;
    const last = out[out.length - 1];
    if (node.kind === 'text' && last?.kind === 'text') last.value += node.value;
    else out.push(node);
}

/**
 * CommonMark's "multiple of 3" rule: a run that can both open and close may not pair across it.
 * Judged on the REMAINING lengths, not the original runs (Codex r6): after `**a***b**c***`
 * pairs `**…**` the 3-run left in front of `c` must still pair as strong + em.
 */
function compatible(o: Delim, cl: Delim): boolean {
    if (o.c !== cl.c || !o.open || o.count === 0) return false;
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

/** Wrap items between opener oi and closer ci in a mark; returns the index to resume at. */
function applyMatch(items: EmphasisItem[], oi: number, ci: number, o: Delim, cl: Delim): number {
    const use = o.count >= 3 && cl.count >= 3 ? 1 : o.count >= 2 && cl.count >= 2 ? 2 : 1;
    const children: InlineNode[] = [];
    items.slice(oi + 1, ci).forEach((it) => pushNode(children, it));
    const mark: InlineNode = { kind: use === 2 ? 'strong' : 'em', children };
    o.count -= use;
    cl.count -= use;
    const keep: EmphasisItem[] = [...(o.count > 0 ? [o] : []), mark, ...(cl.count > 0 ? [cl] : [])];
    items.splice(oi, ci - oi + 1, ...keep);
    // A closer with characters left is retried in place; otherwise move past the mark.
    return oi + (o.count > 0 ? 1 : 0) + 1;
}

/**
 * Pair the delimiter runs in `items` into em / strong nodes; unpaired runs
 * become literal text.
 * @param items - nodes and delimiter runs in source order (mutated)
 * @returns the resolved node list, adjacent text merged
 */
export function resolveEmphasis(items: EmphasisItem[]): InlineNode[] {
    let ci = 0;
    while (ci < items.length) {
        const cl = items[ci];
        const oi = cl?.kind === 'delim' && cl.close && cl.count > 0 ? findOpener(items, ci, cl) : -1;
        const o = items[oi];
        if (cl?.kind !== 'delim' || o?.kind !== 'delim') { ci++; continue; }
        ci = applyMatch(items, oi, ci, o, cl);
    }
    const out: InlineNode[] = [];
    items.forEach((it) => pushNode(out, it));
    return out;
}
