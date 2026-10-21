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
import { normalizeEditorMarkdown } from './markdown-serialize';

type Segment = [text: string, marks: string];

const MARK_OF: Record<string, string> = { b: 'bold', i: 'italic', s: 'strike', c: 'code' };
const TAG_OF: Record<string, string> = { STRONG: 'b', EM: 'i', S: 's', DEL: 's', CODE: 'c' };
const COMBOS = ['', 'b', 'i', 's', 'bi', 'bs', 'is', 'bis'];
const editor = new Editor({ extensions: buildMarkdownExtensions({ onLinkShortcut: () => undefined }) });

afterAll(() => { editor.destroy(); });

/** Build the paragraph in the editor and save it the way `MarkdownEditor` does. */
function save(segments: Segment[]): string {
    const content: JSONContent[] = segments.map(([text, marks]) => ({
        type: 'text', text, ...(marks === '' ? {} : { marks: [...marks].map((m) => ({ type: MARK_OF[m] ?? m })) }),
    }));
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content }] });
    return normalizeEditorMarkdown(editor.getMarkdown());
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

describe('every bold/italic/strike overlap round-trips editor → stored markdown → MarkdownBlock (Codex r6)', () => {
    it.each([
        ['adjacent segments (512)', (): Segment[][] => triples(['a', 'b', 'c'])],
        ['space-separated segments (512)', (): Segment[][] => triples(['a ', 'b ', 'c'])],
        ['inline-code middle segment (64)', codeMiddle],
    ])('%s', (_label, build) => {
        const cases = build();
        const bad = failures(cases);
        expect(bad.slice(0, 8), `${bad.length} of ${cases.length} cases failed`).toEqual([]);
    });
});
