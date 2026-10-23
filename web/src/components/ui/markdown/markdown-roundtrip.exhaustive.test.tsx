/**
 * Codex r6 (ROK-1868) — closes the overlapping-marks CLASS, not one case at a
 * time. For three adjacent text segments, every combination of
 * {bold, italic, strike} per segment (8³ = 512) is built in the real editor
 * (production extensions), saved through the production path
 * (`serializeEditorMarkdown`), and must
 *   (a) pass `findHubPostMarkdownViolation` — the editor never emits HTML, and
 *   (b) render through `MarkdownBlock` with the same marks on every character.
 * Variants: segments separated by spaces, and an inline-code middle segment.
 * ROK-1898: the same sets inside a `#` / `##` / `###` heading, which must also still render as
 * that heading's tag (`MD_HEADING_TAG`) — plus heading text that opens with block syntax.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Editor, type JSONContent } from '@tiptap/core';
import { findHubPostMarkdownViolation, type HubPostHeadingLevel } from '@raid-ledger/contract';
import { MarkdownBlock } from '../markdown-block';
import { buildMarkdownExtensions } from './markdown-extensions';
import { serializeEditorMarkdown } from './markdown-serialize';
import { loadStoredMarkdown } from './markdown-load';
import { MD_HEADING_TAG } from './markdown-classes';

type Segment = [text: string, marks: string];

const MARK_OF: Record<string, string> = { b: 'bold', i: 'italic', s: 'strike', c: 'code', l: 'link' };
const TAG_OF: Record<string, string> = { STRONG: 'b', EM: 'i', S: 's', DEL: 's', CODE: 'c', A: 'l' };
const HREF = 'https://example.com';
const COMBOS = ['', 'b', 'i', 's', 'bi', 'bs', 'is', 'bis'];
const editor = new Editor({ extensions: buildMarkdownExtensions({ onLinkShortcut: () => undefined }) });

afterAll(() => { editor.destroy(); });

/** Save the editor's current document the way `MarkdownEditor` does. */
function saveCurrent(): string {
    return serializeEditorMarkdown(editor);
}

/** The block the segments sit in: a paragraph, or a heading of one level. */
type Wrap = { type: 'paragraph' } | { type: 'heading'; attrs: { level: HubPostHeadingLevel } };
const PARAGRAPH: Wrap = { type: 'paragraph' };
const heading = (level: HubPostHeadingLevel): Wrap => ({ type: 'heading', attrs: { level } });
const tagOf = (wrap: Wrap): string => (wrap.type === 'heading' ? MD_HEADING_TAG[wrap.attrs.level] : 'p').toUpperCase();

/** Build the block in the editor and save it the way `MarkdownEditor` does. */
function save(segments: Segment[], wrap: Wrap = PARAGRAPH): string {
    const content: JSONContent[] = segments.map(([text, marks]) => ({
        type: 'text', text, ...(marks === '' ? {} : { marks: [...marks].map((m) => (m === 'l' ? { type: 'link', attrs: { href: HREF } } : { type: MARK_OF[m] ?? m })) }),
    }));
    editor.commands.setContent({ type: 'doc', content: [{ ...wrap, content }] });
    return saveCurrent();
}

/** Per-character mark signature (`a:bi`), whitespace ignored — a mark on a space is invisible. */
function signature(chars: Array<[string, string]>): string {
    return chars.filter(([ch]) => ch.trim() !== '').map(([ch, m]) => `${ch}:${[...m].sort().join('')}`).join(' ');
}

/** The signature the editor document carries. */
function expected(segments: Segment[]): string {
    return signature(segments.flatMap(([text, marks]) => [...text].map((ch): [string, string] => [ch, marks])));
}

/** `MarkdownBlock`'s output for the saved markdown, in a detached root. */
function rendered(markdown: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(<MarkdownBlock text={markdown} />);
    return root;
}

/** The tag of the first rendered block — `shown()` ignores block tags, so a demoted heading needs this. */
function firstBlockTag(root: HTMLElement): string {
    return root.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol')?.tagName ?? 'NONE';
}

/** The signature `MarkdownBlock` renders for the saved markdown. */
function shown(markdown: string | HTMLElement): string {
    const root = typeof markdown === 'string' ? rendered(markdown) : markdown;
    const chars: Array<[string, string]> = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        let marks = '';
        for (let p = n.parentElement; p && p !== root; p = p.parentElement) marks += TAG_OF[p.tagName] ?? '';
        for (const ch of n.textContent ?? '') chars.push([ch, marks]);
    }
    return signature(chars);
}

/** Every failing case as `label → saved → shown`, so a red run names what broke. */
function failures(cases: Segment[][], wrap: Wrap = PARAGRAPH): string[] {
    const out: string[] = [];
    for (const segments of cases) {
        const saved = save(segments, wrap);
        const violation = findHubPostMarkdownViolation(saved);
        const root = rendered(saved);
        const got = shown(root);
        const tag = firstBlockTag(root);
        const want = expected(segments);
        if (violation !== null || got !== want || tag !== tagOf(wrap)) {
            out.push(`${JSON.stringify(segments)} saved ${JSON.stringify(saved)} → <${tag}> ${violation ? `VIOLATION ${violation}` : got} (want <${tagOf(wrap)}> ${want})`);
        }
    }
    return out;
}

/** All 8³ mark combinations over the given three texts. */
function triples(texts: [string, string, string]): Segment[][] {
    return COMBOS.flatMap((m1) => COMBOS.flatMap((m2) => COMBOS.map((m3): Segment[] => [
        [texts[0], m1], [texts[1], m2], [texts[2], m3],
    ])));
}

/** 8² outer combinations around an inline-code middle segment. */
function codeMiddle(): Segment[][] {
    return COMBOS.flatMap((m1) => COMBOS.map((m3): Segment[] => [['a', m1], ['b', 'c'], ['c', m3]]));
}

/**
 * Codex r9: a marked link between two segments (8³ = 512). TipTap writes `a**[b](…)c**`, whose
 * opening `**` sits between a word character and `[` — not left-flanking, so MarkdownBlock showed it.
 */
function linkMiddle(): Segment[][] {
    return COMBOS.flatMap((m1) => COMBOS.flatMap((m2) => COMBOS.map((m3): Segment[] => [
        ['a', m1], ['b', `${m2}l`], ['c', m3],
    ])));
}

describe('every bold/italic/strike overlap round-trips editor → stored markdown → MarkdownBlock (Codex r6)', () => {
    it.each([
        ['adjacent segments (512)', (): Segment[][] => triples(['a', 'b', 'c'])],
        ['space-separated segments (512)', (): Segment[][] => triples(['a ', 'b ', 'c'])],
        ['inline-code middle segment (64)', codeMiddle],
        ['marked-link middle segment (512)', linkMiddle],
    ])('%s', (_label, build) => {
        const cases = build();
        const bad = failures(cases);
        expect(bad.slice(0, 8), `${bad.length} of ${cases.length} cases failed`).toEqual([]);
    });
});

const LEVELS: HubPostHeadingLevel[] = [1, 2, 3];
const BLOCK_PREFIXES = ['# ', '- ', '1. ', '> '];

/** Heading text whose first segment is block syntax (`# ` / `- ` / `1. ` / `> `), 8² marks each. */
function blockPrefixFirst(): Segment[][] {
    return BLOCK_PREFIXES.flatMap((prefix) => COMBOS.flatMap((m1) => COMBOS.map((m2): Segment[] => [
        [prefix, m1], ['b', m2], ['c', ''],
    ])));
}

describe.each(LEVELS)('the same overlaps inside a level-%i heading stay that heading (ROK-1898)', (level) => {
    it.each([
        ['adjacent segments (512)', (): Segment[][] => triples(['a', 'b', 'c'])],
        ['space-separated segments (512)', (): Segment[][] => triples(['a ', 'b ', 'c'])],
        ['inline-code middle segment (64)', codeMiddle],
        ['first segment is block syntax (4 × 64)', blockPrefixFirst],
    ])('%s', (_label, build) => {
        const cases = build();
        const bad = failures(cases, heading(level));
        expect(bad.slice(0, 8), `${bad.length} of ${cases.length} cases failed`).toEqual([]);
    });
});

/**
 * Codex r10: one marked span in every left / right context. TipTap writes bold `(raid)` in
 * `a(raid)c` as `a**(raid)**c`; that `**` is not left-flanking, so no CommonMark reader opens it.
 * Such a span is unrepresentable, so bold / italic / strike give up the edge punctuation that touches a
 * letter (`a(**raid**)c`). Each case must (i) pass the subset check, (ii) render the marks the
 * reloaded editor shows — the editor's marks minus exactly that edge punctuation — and (iii)
 * reload and save again byte-for-byte.
 */
const LEFT: Record<string, Segment[]> = { letter: [['a', '']], space: [['a ', '']], start: [] };
const RIGHT: Record<string, Segment[]> = { letter: [['c', '']], space: [[' c', '']], end: [] };
const INNER = ['raid', '(raid)', '!', ',', '日本'];
const FLANK_MARKS = ['b', 'i', 's', 'c', 'bi'];
const PUNCT = /[\p{P}\p{S}]/u;
const LETTER_OF: Record<string, string> = Object.fromEntries(Object.entries(MARK_OF).map(([k, v]) => [v, k]));

/** The span as a CommonMark reader can show it: bold / italic / strike leave punctuation that touches a letter. */
function representable(text: string, marks: string, left: string, right: string): Segment[] {
    if (!/[bis]/.test(marks)) return [[text, marks]];
    const chars = [...text];
    let s = 0;
    let e = chars.length;
    if (left === 'letter') while (s < e && PUNCT.test(chars[s] ?? '')) s++;
    if (right === 'letter') while (e > s && PUNCT.test(chars[e - 1] ?? '')) e--;
    const rest = marks.replace(/[bis]/g, '');
    return [[chars.slice(0, s).join(''), rest], [chars.slice(s, e).join(''), marks], [chars.slice(e).join(''), rest]];
}

/** The signature the editor currently holds. */
function loaded(): string {
    const doc: JSONContent = editor.getJSON();
    const nodes = doc.content?.[0]?.content ?? [];
    return signature(nodes.flatMap((n) => [...(n.text ?? '')].map((ch): [string, string] => [ch, (n.marks ?? []).map((m) => LETTER_OF[m.type] ?? m.type).join('')])));
}

/** One context case; a message naming what broke, or null. */
function flankFailure(segments: Segment[], want: string): string | null {
    const saved = save(segments);
    const violation = findHubPostMarkdownViolation(saved);
    const got = shown(saved);
    editor.commands.setContent(loadStoredMarkdown(saved));
    const reloadedShows = loaded();
    const resaved = saveCurrent();
    if (violation === null && got === want && reloadedShows === got && resaved === saved) return null;
    return `${JSON.stringify(segments)} saved ${JSON.stringify(saved)} → ${violation ? `VIOLATION ${violation}` : got} (want ${want}); reloaded editor ${reloadedShows}; resaved ${JSON.stringify(resaved)}`;
}

function flankCases(): Array<[Segment[], string]> {
    return Object.entries(LEFT).flatMap(([l, left]) => Object.entries(RIGHT).flatMap(([r, right]) => INNER.flatMap((text) => FLANK_MARKS.map((marks): [Segment[], string] => [
        [...left, [text, marks], ...right],
        expected([...left, ...representable(text, marks, l, r), ...right]),
    ]))));
}

describe('a marked span in every left / right context round-trips (Codex r10)', () => {
    it('mark × left × right × inner text (225)', () => {
        const cases = flankCases();
        const bad = cases.map(([segments, want]) => flankFailure(segments, want)).filter((m): m is string => m !== null);
        expect(bad.slice(0, 8), `${bad.length} of ${cases.length} cases failed`).toEqual([]);
    });
});
