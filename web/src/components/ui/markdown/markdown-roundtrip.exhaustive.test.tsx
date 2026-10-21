/**
 * Codex r6 (ROK-1868) — closes the overlapping-marks CLASS, not one case at a
 * time. For three adjacent text segments, every combination of
 * {bold, italic, strike} per segment (8³ = 512) is built in the real editor
 * (production extensions), saved through the production path
 * (`getMarkdown()` → `normalizeEditorMarkdown`), and must
 *   (a) pass `findHubPostMarkdownViolation` — the editor never emits HTML, and
 *   (b) render through `MarkdownBlock` with the same marks on every character.
 * Variants: segments separated by spaces, and an inline-code middle segment.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Editor, type JSONContent } from '@tiptap/core';
import { findHubPostMarkdownViolation } from '@raid-ledger/contract';
import { MarkdownBlock } from '../markdown-block';
import { buildMarkdownExtensions } from './markdown-extensions';
import { normalizeEditorMarkdown, prepareEditorMarkdown } from './markdown-serialize';

type Segment = [text: string, marks: string];

const MARK_OF: Record<string, string> = { b: 'bold', i: 'italic', s: 'strike', c: 'code', l: 'link' };
const TAG_OF: Record<string, string> = { STRONG: 'b', EM: 'i', S: 's', DEL: 's', CODE: 'c', A: 'l' };
const HREF = 'https://example.com';
const COMBOS = ['', 'b', 'i', 's', 'bi', 'bs', 'is', 'bis'];
const editor = new Editor({ extensions: buildMarkdownExtensions({ onLinkShortcut: () => undefined }) });

afterAll(() => { editor.destroy(); });

/** Save the editor's current document the way `MarkdownEditor` does. */
function saveCurrent(): string {
    return normalizeEditorMarkdown(editor.getMarkdown());
}

/** Build the paragraph in the editor and save it the way `MarkdownEditor` does. */
function save(segments: Segment[]): string {
    const content: JSONContent[] = segments.map(([text, marks]) => ({
        type: 'text', text, ...(marks === '' ? {} : { marks: [...marks].map((m) => (m === 'l' ? { type: 'link', attrs: { href: HREF } } : { type: MARK_OF[m] ?? m })) }),
    }));
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content }] });
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

/** The signature `MarkdownBlock` renders for the saved markdown. */
function shown(markdown: string): string {
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(<MarkdownBlock text={markdown} />);
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
function failures(cases: Segment[][]): string[] {
    const out: string[] = [];
    for (const segments of cases) {
        const saved = save(segments);
        const violation = findHubPostMarkdownViolation(saved);
        const got = shown(saved);
        const want = expected(segments);
        if (violation !== null || got !== want) {
            out.push(`${JSON.stringify(segments)} saved ${JSON.stringify(saved)} → ${violation ? `VIOLATION ${violation}` : got} (want ${want})`);
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

/**
 * Codex r10: one marked span in every left / right context. TipTap writes bold `(raid)` in
 * `a(raid)c` as `a**(raid)**c`; that `**` is not left-flanking, so no CommonMark reader opens it.
 * Such a span is unrepresentable, so bold / italic give up the edge punctuation that touches a
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

/** The span as a CommonMark reader can show it: bold / italic leave punctuation that touches a letter. */
function representable(text: string, marks: string, left: string, right: string): Segment[] {
    if (!/[bi]/.test(marks)) return [[text, marks]];
    const chars = [...text];
    let s = 0;
    let e = chars.length;
    if (left === 'letter') while (s < e && PUNCT.test(chars[s] ?? '')) s++;
    if (right === 'letter') while (e > s && PUNCT.test(chars[e - 1] ?? '')) e--;
    const rest = marks.replace(/[bi]/g, '');
    return [[chars.slice(0, s).join(''), rest], [chars.slice(s, e).join(''), marks], [chars.slice(e).join(''), rest]];
}

/** The signature the editor currently holds. */
function loaded(): string {
    const nodes = editor.getJSON().content?.[0]?.content ?? [];
    return signature(nodes.flatMap((n) => [...(n.text ?? '')].map((ch): [string, string] => [ch, (n.marks ?? []).map((m) => LETTER_OF[m.type] ?? m.type).join('')])));
}

/** One context case; a message naming what broke, or null. */
function flankFailure(segments: Segment[], want: string): string | null {
    const saved = save(segments);
    const violation = findHubPostMarkdownViolation(saved);
    const got = shown(saved);
    editor.commands.setContent(prepareEditorMarkdown(saved), { contentType: 'markdown' });
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
