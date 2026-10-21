/**
 * V10 (ROK-1868) — MarkdownEditor with real TipTap in jsdom: markdown
 * round-trip, toolbar → markdown, link row, keyboard, paste normalisation,
 * and the contract guarantee (no output trips findHubPostMarkdownViolation).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { findHubPostMarkdownViolation } from '@raid-ledger/contract';
import MarkdownEditor from './markdown-editor';
import { normalizeEditorMarkdown } from './markdown-serialize';
import { MarkdownBlock } from '../markdown-block';

// jsdom has no ClipboardEvent; ProseMirror's pasteHTML constructs one.
if (typeof globalThis.ClipboardEvent === 'undefined') {
    Object.defineProperty(globalThis, 'ClipboardEvent', {
        value: class extends Event { clipboardData: DataTransfer | null = null; },
    });
}

function setup(value = '', maxLength = 4000) {
    const onChange = vi.fn();
    const utils = render(<MarkdownEditor value={value} onChange={onChange} maxLength={maxLength} testId="ed" />);
    const el = utils.container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null;
    if (!el?.editor) throw new Error('editor element missing');
    const last = (): string => String(onChange.mock.calls.at(-1)?.[0] ?? '');
    return { ...utils, editor: el.editor, el, onChange, last };
}

const ROUND_TRIP = [
    'plain words', '**bold** and *italic*', '~~gone~~ `code`', '[plan](https://example.com/a)',
    '[home](/guilds/7?post=3#posts)', '- one\n- two', '1. first\n2. second', 'line one  \nline two',
    'para one\n\npara two', '**Raid night** at 8\n\n- bring flasks\n- be on time',
    // Codex r7: stored entity text is literal (MarkdownBlock prints it as typed) — a load + save keeps it.
    'Use &lt;raid&gt;', 'a &amp; b &#39; c &nbsp; d', '**&lt;b&gt;** and `&lt;code&gt;` &copy;',
    '[q](https://example.com/?q=&lt;)', '[both &amp;](https://example.com/?a=1&amp;b=2)',
    // Codex r9: no task-list extension, so a GFM task marker is literal text — not dropped on load.
    '- [x] a', '- [ ] b', '- [x] done\n- [ ] todo', '1. [X] first', '- plain\n- [x] checked',
];

describe('MarkdownEditor (V10)', () => {
    it.each(ROUND_TRIP)('round-trips %j unchanged', (md) => {
        const { editor } = setup(md);
        expect(normalizeEditorMarkdown(editor.getMarkdown())).toBe(md);
    });

    it('MarkdownBlock shows a task marker as literal list-item text (Codex r9)', () => {
        const { container } = render(<MarkdownBlock text={'- [x] a\n- [ ] b'} />);
        expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['[x] a', '[ ] b']);
        expect(container.querySelector('input')).toBeNull();
    });

    it.each([
        ['bold', '**raid**'], ['italic', '*raid*'], ['strike', '~~raid~~'], ['code', '`raid`'],
        ['bullets', '- raid'], ['numbers', '1. raid'],
    ])('toolbar %s on a selection emits %j', (key, expected) => {
        const { editor, last } = setup('raid');
        editor.commands.selectAll();
        fireEvent.click(screen.getByTestId(`md-tool-${key}`));
        expect(last()).toBe(expected);
    });

    it('aria-pressed follows the selection and Mod-B toggles bold', () => {
        const { editor, el, last } = setup('raid');
        editor.commands.selectAll();
        fireEvent.keyDown(el, { key: 'b', ctrlKey: true });
        expect(last()).toBe('**raid**');
        expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('link row: bare host becomes https, javascript: is refused', () => {
        const { editor, last } = setup('raid');
        editor.commands.selectAll();
        fireEvent.click(screen.getByTestId('md-tool-link'));
        const input = screen.getByLabelText('Link address');
        fireEvent.change(input, { target: { value: 'javascript:x' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(screen.getByText(/Links must start with https:\/\//)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(last()).toBe('[raid](https://example.com)');
    });

});

describe('MarkdownEditor (V10) — keyboard, paste, contract', () => {
    it('roving tabindex: one Tab stop, ArrowRight moves focus', () => {
        setup('x');
        const buttons = screen.getAllByRole('button');
        expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
        buttons[0]?.focus();
        fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'ArrowRight' });
        expect(document.activeElement).toBe(buttons[1]);
    });

    it('paste: HTML outside the subset is normalised away', () => {
        const { editor, last } = setup('');
        editor.view.pasteHTML('<h1>T</h1><p><u>u</u> <img src="x"><a href="javascript:x">j</a></p><table><tr><td>c</td></tr></table>');
        const md = last();
        for (const bad of ['#', '<', '![', 'javascript', '|']) expect(md).not.toContain(bad);
        expect(md).toContain('T');
    });

    it('paste: nested lists flatten', () => {
        const { editor, last } = setup('');
        editor.view.pasteHTML('<ul><li>a<ul><li>b</li></ul></li></ul>');
        expect(last()).toBe('- a\n- b');
    });

    it('typed HTML / markdown-looking text never trips the contract scanner', () => {
        const { editor, last } = setup('');
        editor.view.dispatch(editor.state.tr.insertText('<script>x</script> & <b>y</b> **z** # h &lt;', 1));
        // Typed `&lt;` is saved bare: the load path escapes entity-like `&` (Codex r7), so it stays literal.
        expect(last()).toBe('\\<script>x\\</script> & \\<b>y\\</b> \\*\\*z\\*\\* # h &lt;');
        expect(findHubPostMarkdownViolation(last())).toBeNull();
    });

    it('legacy block syntax loads as literal text instead of blanking the editor', () => {
        const { editor } = setup('# Raid\n\n> quote');
        expect(editor.getText()).toContain('# Raid');
        expect(editor.getText()).toContain('> quote');
    });

    it('counter shows source length and 4001 is invalid', () => {
        setup('x'.repeat(4001));
        expect(screen.getByTestId('md-editor-count')).toHaveTextContent('4001/4000');
        expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    });
});

describe('MarkdownEditor — stored image syntax (ROK-1868 Codex P2)', () => {
    it('loads ![alt](url) as literal text and saves it back unchanged', () => {
        const md = 'Before ![map](https://example.com/map.png) after';
        const { editor } = setup(md);
        expect(editor.getText(), 'the image source must stay literal text, not collapse to its alt').toBe(md);
        const saved = normalizeEditorMarkdown(editor.getMarkdown());
        // The serializer escapes the brackets (`!\\[map\\](…)`), which is the same literal
        // text: it must keep the URL and read exactly like the stored source.
        expect(saved, 'the URL must survive a save').toContain('(https://example.com/map.png)');
        const shown = (text: string): string | null => render(<MarkdownBlock text={text} />).container.textContent;
        expect(shown(saved), 'the saved source must display exactly like the stored one').toBe(shown(md));
    });
});

describe('MarkdownEditor — multi-backtick code spans (Codex r3)', () => {
    const CODE = 'a `<b>` &lt; c';

    it('normalisation leaves a two-backtick code span verbatim', () => {
        expect(normalizeEditorMarkdown('x ``a `<b>` &lt; c`` &lt;y')).toBe('x ``a `<b>` &lt; c`` \\<y');
    });

    it('inline code containing a backtick and &lt; survives a save unchanged', () => {
        const { editor } = setup('');
        editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: CODE, marks: [{ type: 'code' }] }] }] });
        const saved = normalizeEditorMarkdown(editor.getMarkdown());
        const code = render(<MarkdownBlock text={saved} />).container.querySelector('code');
        expect(code?.textContent, `saved ${JSON.stringify(saved)} must keep the code text`).toBe(CODE);
    });
});

describe('MarkdownEditor — escaped backticks are not code spans (Codex r4)', () => {
    it('normalisation decodes entities between backslash-escaped backticks', () => {
        expect(normalizeEditorMarkdown('\\`a &amp; b &lt;c\\`')).toBe('\\`a & b \\<c\\`');
    });

    it('a typed literal `a & b` saves with a plain & and displays unchanged', () => {
        const { editor, last } = setup('');
        editor.view.dispatch(editor.state.tr.insertText('`a & b`', 1));
        expect(last(), 'the & must not be saved as an entity').not.toContain('&amp;');
        expect(render(<MarkdownBlock text={last()} />).container.textContent).toBe('`a & b`');
    });
});

describe('MarkdownEditor — stored inline HTML stays literal (Codex r4)', () => {
    it.each([
        ['an <img> tag', 'Before <img src=x> after', 'Before \\<img src=x> after'],
        ['a <b> pair', 'say <b>text</b> now', 'say \\<b>text\\</b> now'],
    ])('loads %s as text and saves it back as escaped literal text', (_l, md, expected) => {
        const { editor } = setup(md);
        expect(editor.getText(), 'the HTML must load as literal text').toBe(md);
        expect(editor.getHTML(), 'no mark may be applied').not.toContain('<strong');
        expect(normalizeEditorMarkdown(editor.getMarkdown())).toBe(expected);
    });
});

describe('MarkdownEditor — empty-paragraph markers (Codex r5)', () => {
    const para = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });

    it.each([
        ['two', [para('before'), para(), para(), para('after')]],
        ['three', [para('before'), para(), para(), para(), para('after')]],
    ])('%s consecutive empty paragraphs save as one paragraph break, no &nbsp;', (_l, content) => {
        const { editor } = setup('');
        editor.commands.setContent({ type: 'doc', content });
        const saved = normalizeEditorMarkdown(editor.getMarkdown());
        expect(saved).toBe('before\n\nafter');
        expect(render(<MarkdownBlock text={saved} />).container.textContent).toBe('beforeafter');
    });

    it.each([
        ['inline', [para('a &nbsp; b')], 'a &nbsp; b'],
        ['as its own paragraph', [para('before'), para('&nbsp;'), para('after')], 'before&nbsp;after'],
    ])('a typed literal &nbsp; (%s) is kept and displays as typed', (_l, content, shown) => {
        const { editor } = setup('');
        editor.commands.setContent({ type: 'doc', content });
        const saved = normalizeEditorMarkdown(editor.getMarkdown());
        expect(saved, 'the typed entity text must survive').toContain('&nbsp;');
        expect(saved, 'and must not be saved entity-encoded').not.toContain('&amp;');
        expect(normalizeEditorMarkdown(setup(saved).editor.getMarkdown()), 'reloading the save must keep it').toBe(saved);
        expect(render(<MarkdownBlock text={saved} />).container.textContent).toBe(shown);
    });
});

describe('MarkdownEditor — link destinations are not entity-decoded (Codex r7)', () => {
    it.each([
        ['[q](https://example.com/?q=&lt;)', '[q](https://example.com/?q=&lt;)'],
        ['[a &amp; b](https://example.com/?a=1&amp;b=2)', '[a & b](https://example.com/?a=1&amp;b=2)'],
        ['[w](https://x.test/Raid_(g&amp;)) &lt;', '[w](https://x.test/Raid_(g&amp;)) \\<'],
    ])('normalising %j keeps the destination byte-for-byte', (raw, expected) => {
        expect(normalizeEditorMarkdown(raw)).toBe(expected);
    });
});
