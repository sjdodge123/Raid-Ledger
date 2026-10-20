/**
 * MarkdownLinkRow (ROK-1868 spec §3.6) — the inline "Link address" row under
 * the toolbar (no popover). A bare `example.com` becomes `https://example.com`;
 * anything failing `isSafeMarkdownHref` shows the contract's unsafe-link
 * message. Empty selection + Apply inserts the URL as the link text. Esc
 * closes and returns focus to the editor.
 */
import { useState, type FormEvent, type JSX, type KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { HUB_POST_MARKDOWN_MESSAGES, isSafeMarkdownHref } from '@raid-ledger/contract';
import { Button } from '../button';
import { Field } from '../field';
import { Input } from '../input';

/**
 * Normalise a typed address: trim, and prefix `https://` to a bare host.
 * @returns the href to store, or null when it is not a safe link
 */
export function normalizeLinkInput(raw: string): string | null {
    const url = raw.trim();
    if (!url) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') ? url : `https://${url}`;
    return isSafeMarkdownHref(withScheme) ? withScheme : null;
}

interface Range { from: number; to: number }

/** Apply to the selection captured when the row opened (the input took focus since). */
function applyLink(editor: Editor, href: string, range: Range): void {
    const chain = editor.chain().focus().setTextSelection(range);
    if (range.from === range.to && !editor.isActive('link')) {
        chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
        return;
    }
    chain.extendMarkRange('link').setLink({ href }).run();
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
    const remove = (): void => { editor.chain().focus().setTextSelection(range).extendMarkRange('link').unsetLink().run(); onClose(); };
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
