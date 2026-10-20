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
];

describe('MarkdownEditor (V10)', () => {
    it.each(ROUND_TRIP)('round-trips %j unchanged', (md) => {
        const { editor } = setup(md);
        expect(normalizeEditorMarkdown(editor.getMarkdown())).toBe(md);
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
        expect(last()).toBe('\\<script>x\\</script> & \\<b>y\\</b> \\*\\*z\\*\\* # h \\&lt;');
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
