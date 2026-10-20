/**
 * MarkdownLinkRow (ROK-1868 spec §3.6) — the inline "Link address" row under
 * the toolbar (no popover). A bare `example.com` becomes `https://example.com`;
 * anything failing `isSafeMarkdownHref` shows the contract's unsafe-link
 * message. Empty selection + Apply inserts the URL as the link text. Esc
 * closes and returns focus to the editor.
 */
import { useState, type FormEvent, type JSX, type KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { HUB_POST_MARKDOWN_MESSAGES } from '@raid-ledger/contract';
import { normalizeLinkInput } from './markdown-link';
import { Button } from '../button';
import { Field } from '../field';
import { Input } from '../input';

interface Range { from: number; to: number }

/**
 * Apply to the selection captured when the row opened. The chain does NOT
 * start with `focus()`: with focus in the URL input, a leading focus command
 * re-resolves the selection and drops the mark (V10); focus is restored after.
 */
function applyLink(editor: Editor, href: string, range: Range): void {
    const sel = editor.state.selection;
    const chain = editor.chain();
    if (sel.from !== range.from || sel.to !== range.to) chain.setTextSelection(range);
    if (range.from === range.to && !editor.isActive('link')) {
        chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
        chain.extendMarkRange('link').setLink({ href }).run();
    }
    editor.commands.focus();
}

/** The inline link editor for {@link MarkdownEditor}. */
export function MarkdownLinkRow({ editor, onClose }: { editor: Editor; onClose: () => void }): JSX.Element {
    const current = editor.getAttributes('link')['href'];
    const [value, setValue] = useState<string>(typeof current === 'string' ? current : '');
    const [error, setError] = useState<string | undefined>(undefined);
    const [range] = useState<Range>(() => ({ from: editor.state.selection.from, to: editor.state.selection.to }));
    const close = (): void => { onClose(); editor.commands.focus(); };
    const submit = (ev: FormEvent): void => {
        ev.preventDefault();
        const href = normalizeLinkInput(value);
        if (!href) { setError(HUB_POST_MARKDOWN_MESSAGES['unsafe-link']); return; }
        applyLink(editor, href, range);
        onClose();
    };
    const remove = (): void => { editor.chain().extendMarkRange('link').unsetLink().run(); close(); };
    const onKeyDown = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } };
    return (
        <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-wrap items-end gap-2 px-2 py-2 border-b border-edge" data-testid="md-link-row">
            <Field label="Link address" error={error} className="flex-1 min-w-[12rem]">
                <Input type="url" inputMode="url" autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError(undefined); }} />
            </Field>
            <Button type="submit" size="sm">Apply</Button>
            {editor.isActive('link') && <Button type="button" variant="ghost" size="sm" onClick={remove}>Remove link</Button>}
        </form>
    );
}
