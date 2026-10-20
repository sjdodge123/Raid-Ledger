/**
 * MarkdownToolbar (ROK-1868 spec §3.6): `role="toolbar"` with ONE Tab stop
 * and roving tabindex (←/→/Home/End). Each action is a ghost icon Button with
 * `aria-label`, `aria-pressed` and `aria-keyshortcuts`. Phone: one row that
 * scrolls horizontally (never wraps). Tokens only.
 */
import { useRef, useState, type KeyboardEvent, type JSX } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Button } from '../button';
import { TOOLBAR_ACTIONS, actionTitle, ariaShortcut } from './markdown-toolbar-actions';

export interface MarkdownToolbarProps {
    editor: Editor;
    controls: string;
    disabled?: boolean | undefined;
    onLink: () => void;
}

const NAV: Record<string, (i: number, n: number) => number> = {
    ArrowRight: (i, n) => (i + 1) % n,
    ArrowLeft: (i, n) => (i - 1 + n) % n,
    Home: () => 0,
    End: (_i, n) => n - 1,
};

function platform(): { mac: boolean; coarse: boolean } {
    const nav = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
    return { mac: /Mac|iPhone|iPad/.test(nav), coarse };
}

/** The formatting toolbar for {@link MarkdownEditor}. */
export function MarkdownToolbar({ editor, controls, disabled, onLink }: MarkdownToolbarProps): JSX.Element {
    const [focus, setFocus] = useState(0);
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const active = useEditorState({ editor, selector: (s) => TOOLBAR_ACTIONS.map((a) => a.isActive(s.editor)) });
    const env = platform();
    const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>): void => {
        const move = NAV[ev.key];
        if (!move) return;
        ev.preventDefault();
        const next = move(focus, TOOLBAR_ACTIONS.length);
        setFocus(next);
        refs.current[next]?.focus();
    };
    return (
        <div role="toolbar" aria-label="Formatting" aria-controls={controls} onKeyDown={onKeyDown}
            className="flex flex-nowrap gap-1 overflow-x-auto scroll-px-2 px-1 py-1 border-b border-edge">
            {TOOLBAR_ACTIONS.map((a, i) => (
                <Button key={a.key} ref={(el) => { refs.current[i] = el; }} type="button" variant="ghost" size="sm" iconOnly
                    aria-label={a.label} aria-pressed={!!active?.[i]} aria-keyshortcuts={ariaShortcut(a.shortcut)}
                    title={actionTitle(a, env)} tabIndex={i === focus ? 0 : -1} disabled={disabled}
                    data-testid={`md-tool-${a.key}`} onFocus={() => setFocus(i)}
                    className={`shrink-0 ${active?.[i] ? 'bg-overlay text-foreground' : 'text-muted'}`}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => (a.run === 'link' ? onLink() : a.run(editor))}>
                    <a.icon aria-hidden className="w-5 h-5" />
                </Button>
            ))}
        </div>
    );
}
