/**
 * Codex r5 (ROK-1868) — every bold / italic / strike combination the toolbar
 * can produce survives publication: TipTap serialises the marked document,
 * `normalizeEditorMarkdown` stores it, and `MarkdownBlock` must render the
 * same marks on the same text — never literal asterisks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Editor, type JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import { Markdown } from '@tiptap/markdown';
import { MarkdownBlock } from '../markdown-block';
import { normalizeEditorMarkdown } from './markdown-serialize';
import { MAX_EMPHASIS_DEPTH } from './markdown-emphasis';

const EXT = [Document, Paragraph, Text, HardBreak, Bold, Italic, Strike, Code, Markdown];
const MARK_OF: Record<string, string> = { b: 'bold', i: 'italic', s: 'strike' };
const TAG_OF: Record<string, string> = { STRONG: 'b', EM: 'i', S: 's' };
let editor: Editor | null = null;

afterEach(() => { editor?.destroy(); editor = null; });

/** `[text, 'bi']` segments → the markdown TipTap saves for them. */
function save(segments: Array<[string, string]>): string {
    const content: JSONContent[] = segments.map(([text, marks]) => ({
        type: 'text', text, marks: [...marks].map((m) => ({ type: MARK_OF[m] ?? m })),
    }));
    editor = new Editor({ extensions: EXT });
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content }] });
    return normalizeEditorMarkdown(editor.getMarkdown());
}

/** The rendered text as `text[marks]` segments, adjacent equal marks merged. */
function shown(markdown: string): string {
    const root = render(<MarkdownBlock text={markdown} />).container;
    const segs: Array<[string, string]> = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const marks = new Set<string>();
        for (let p = n.parentElement; p && p !== root; p = p.parentElement) {
            const tag = TAG_OF[p.tagName];
            if (tag) marks.add(tag);
        }
        const key = [...marks].sort().join('');
        const last = segs[segs.length - 1];
        if (last && last[1] === key) last[0] += n.textContent ?? '';
        else segs.push([n.textContent ?? '', key]);
    }
    return segs.map(([t, m]) => `${t}[${m}]`).join('|');
}

const CASES: Array<[string, Array<[string, string]>]> = [
    ['bold+italic then italic', [['both', 'bi'], [' italic', 'i']]],
    ['bold then adjacent italic', [['bold', 'b'], ['italic', 'i']]],
    ['italic then adjacent bold', [['italic', 'i'], ['bold', 'b']]],
    ['bold+italic then bold', [['a', 'bi'], [' b', 'b']]],
    ['bold then bold+italic', [['a ', 'b'], ['b', 'bi']]],
    ['italic then bold+italic', [['a ', 'i'], ['b', 'bi']]],
    ['italic, bold+italic, italic', [['a', 'i'], ['b', 'bi'], ['c', 'i']]],
    ['bold, bold+italic, bold', [['a', 'b'], ['b', 'bi'], ['c', 'b']]],
    ['bold+italic whole', [['x', 'bi']]],
    ['bold+italic adjacent bold', [['a', 'bi'], ['b', 'b']]],
    ['bold+italic+strike then bold', [['a', 'bis'], [' b', 'b']]],
    ['bold+strike then italic', [['a', 'bs'], ['b', 'i']]],
    ['strike, bold+strike', [['a ', 's'], ['b', 'bs']]],
    ['plain, bold+italic, plain', [['x ', ''], ['y', 'bi'], [' z', '']]],
];

describe('MarkdownBlock renders every toolbar mark combination (Codex r5)', () => {
    it.each(CASES)('%s', (_label, segments) => {
        const saved = save(segments);
        const expected = segments.map(([t, m]) => `${t}[${[...m].sort().join('')}]`).join('|');
        expect(shown(saved), `saved ${JSON.stringify(saved)}`).toBe(expected);
    });
});

/** Deepest chain of em / strong / s elements in a rendered tree. */
function markDepth(el: Element): number {
    let max = 0;
    for (const child of el.children) max = Math.max(max, markDepth(child));
    return max + (TAG_OF[el.tagName] ? 1 : 0);
}

/** Render, catching the throw so a stack overflow fails as an assertion, not a crash. */
function tryRender(body: string): { root: HTMLElement | null; error: unknown } {
    try {
        return { root: render(<MarkdownBlock text={body} />).container, error: null };
    } catch (error) {
        return { root: null, error };
    }
}

describe('emphasis nesting is bounded (Codex r8)', () => {
    it('a 3999-char run of asterisks around one letter renders without overflowing the stack', () => {
        const body = `${'*'.repeat(1999)}x${'*'.repeat(1999)}`;
        const { root: shownRoot, error } = tryRender(body);
        expect(error, 'render error').toBeNull();
        expect(shownRoot?.textContent).toContain('x');
        expect(markDepth(shownRoot ?? document.body), 'mark nesting depth').toBeLessThanOrEqual(MAX_EMPHASIS_DEPTH);
        // Every delimiter not spent on a capped pair stays literal text.
        expect(shownRoot?.textContent?.length).toBe(body.length - 2 * MAX_EMPHASIS_DEPTH);
    });

    it('alternating * and _ runs nest only to the cap', () => {
        const body = `${'*_'.repeat(500)}x${'_*'.repeat(500)}`;
        const { root: shownRoot, error } = tryRender(body);
        expect(error, 'render error').toBeNull();
        expect(markDepth(shownRoot ?? document.body), 'mark nesting depth').toBeLessThanOrEqual(MAX_EMPHASIS_DEPTH);
    });

    it('legit nesting below the cap still renders every mark', () => {
        expect(shown('*a **b ~~c~~ b** a*')).toBe('a [i]|b [bi]|c[bis]| b[bi]| a[i]');
        expect(shown('***~~x~~***')).toBe('x[bis]');
    });
});
