/**
 * Bold / italic / strike edges that no CommonMark reader can open or close (ROK-1868, Codex r10).
 *
 * A `*` run opens only when left-flanking and closes only when right-flanking.
 * So a span that starts with punctuation right after a letter (`a**(raid)**c`,
 * `日本**「x」**`) or ends with punctuation right before one cannot be written
 * in CommonMark at all: no escape helps, the backslash is punctuation too, and
 * the subset forbids `<strong>`. `MarkdownBlock`, the editor's own loader
 * (`marked`) and the Discord relay would all print the asterisks.
 *
 * GFM strike follows the same flanking rules, and the editor's loader applies
 * them: `a~~(raid)~~c` renders struck in `MarkdownBlock` but reloads as text.
 *
 * Before serialising, each bold / italic / strike run in the editor document gives up
 * such edge characters: its start moves forward while the opening delimiter
 * could not open, its end moves back while the closing one could not close.
 * `a(raid)c` with `(raid)` bold saves as `a(**raid**)c`; a span made only of
 * such punctuation (`a**!**c`) loses the mark. This is lossy by design: the
 * saved text is what every reader shows, and a reload shows the same.
 *
 * Neighbours are judged as the markdown writes them: a code span is wrapped in
 * backticks (punctuation), a link edge writes `[` / `](…)` (punctuation), a
 * hard break or the block edge is whitespace.
 */
import type { JSONContent } from '@tiptap/core';

type Cls = 'space' | 'punct' | 'other';
type MarkJSON = NonNullable<JSONContent['marks']>[number];

/** One character of a text block, or a non-text inline node kept verbatim. */
interface Ch {
    ch: string;
    marks: MarkJSON[];
    link: string | null;
    node: JSONContent | null;
}

const EMPHASIS = ['bold', 'italic', 'strike'];
const PUNCT = /[\p{P}\p{S}]/u;

const linkOf = (marks: MarkJSON[]): string | null => {
    const link = marks.find((m: MarkJSON): boolean => m.type === 'link');
    return link === undefined ? null : JSON.stringify(link.attrs ?? {});
};

const has = (c: Ch | undefined, type: string): boolean => c !== undefined && c.marks.some((m: MarkJSON): boolean => m.type === type);

function classOf(c: Ch | undefined): Cls {
    if (c === undefined || c.node !== null) return 'space';
    if (has(c, 'code')) return 'punct';
    if (c.ch.trim() === '') return 'space';
    return PUNCT.test(c.ch) ? 'punct' : 'other';
}

/** The class of `outer` as the delimiter beside `inner` sees it: a link edge between them is `[` or `](…)`. */
function neighbour(chars: Ch[], outer: number, inner: number): Cls {
    const o = chars[outer];
    const i = chars[inner];
    if (o !== undefined && o.node === null && i !== undefined && o.link !== i.link) return 'punct';
    return classOf(o);
}

/** CommonMark left- / right-flanking for a `*` (or GFM `~~`) run between classes p and n. */
const canOpen = (p: Cls, n: Cls): boolean => n !== 'space' && (n !== 'punct' || p !== 'other');
const canClose = (p: Cls, n: Cls): boolean => p !== 'space' && (p !== 'punct' || n !== 'other');

const drop = (c: Ch, type: string): void => { c.marks = c.marks.filter((m: MarkJSON): boolean => m.type !== type); };

/** Shrink the run of `type` over [start, end] until both its delimiters can act; true when anything changed. */
function trimRun(chars: Ch[], type: string, start: number, end: number): boolean {
    let s = start;
    let e = end;
    for (let c = chars[s]; c !== undefined && s <= e && !canOpen(neighbour(chars, s - 1, s), classOf(c)); c = chars[s]) {
        drop(c, type);
        s++;
    }
    for (let c = chars[e]; c !== undefined && e >= s && !canClose(classOf(c), neighbour(chars, e + 1, e)); c = chars[e]) {
        drop(c, type);
        e--;
    }
    return s !== start || e !== end;
}

/** Trim every bold / italic / strike run in one text block's characters; true when anything changed. */
function trimAll(chars: Ch[]): boolean {
    let changed = false;
    for (const type of EMPHASIS) {
        for (let i = 0; i < chars.length; i++) {
            if (!has(chars[i], type)) continue;
            let j = i;
            while (has(chars[j + 1], type)) j++;
            changed = trimRun(chars, type, i, j) || changed;
            i = j;
        }
    }
    return changed;
}

function explode(content: JSONContent[]): Ch[] {
    return content.flatMap((node: JSONContent): Ch[] => {
        if (node.type !== 'text') return [{ ch: '', marks: [], link: null, node }];
        const marks = node.marks ?? [];
        return Array.from(node.text ?? '', (ch: string): Ch => ({ ch, marks: [...marks], link: linkOf(marks), node: null }));
    });
}

function rebuild(chars: Ch[]): JSONContent[] {
    const out: JSONContent[] = [];
    let open: JSONContent | null = null;
    for (const c of chars) {
        if (c.node !== null) { out.push(c.node); open = null; continue; }
        if (open !== null && JSON.stringify(open.marks ?? []) === JSON.stringify(c.marks)) { open.text = `${open.text ?? ''}${c.ch}`; continue; }
        open = { type: 'text', text: c.ch, ...(c.marks.length > 0 ? { marks: c.marks } : {}) };
        out.push(open);
    }
    return out;
}

/**
 * Drop bold / italic / strike from span-edge characters no CommonMark delimiter can open or close beside.
 * @param doc - the editor document (`editor.getJSON()`); not mutated
 * @returns the same document, or a copy whose mark runs all start and end where `*` / `~~` can act
 */
export function trimUnflankedEmphasis(doc: JSONContent): JSONContent {
    const content = doc.content;
    if (content === undefined) return doc;
    if (!content.some((n: JSONContent): boolean => n.type === 'text')) {
        return { ...doc, content: content.map(trimUnflankedEmphasis) };
    }
    const chars = explode(content);
    return trimAll(chars) ? { ...doc, content: rebuild(chars) } : doc;
}
