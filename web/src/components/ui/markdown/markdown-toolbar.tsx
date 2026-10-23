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

/** Key → [first candidate index, step]; the walk skips disabled buttons. */
const NAV: Record<string, (i: number, n: number) => [number, 1 | -1]> = {
    ArrowRight: (i) => [i + 1, 1],
    ArrowLeft: (i) => [i - 1, -1],
    Home: () => [0, 1],
    End: (_i, n) => [n - 1, -1],
};

/** The first enabled index walking from `start` by `step` (wrapping), or -1 when none is enabled. */
function walkEnabled(enabled: boolean[], start: number, step: 1 | -1): number {
    const n = enabled.length;
    for (let k = 0; k < n; k++) {
        const i = (((start + k * step) % n) + n) % n;
        if (enabled[i]) return i;
    }
    return -1;
}

function platform(): { mac: boolean; coarse: boolean } {
    const nav = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
    return { mac: /Mac|iPhone|iPad/.test(nav), coarse };
}

/** Per-action pressed + enabled flags, recomputed on every editor transaction (caret moves included). */
function useToolbarState(editor: Editor): { active: boolean[]; enabled: boolean[] } | null {
    return useEditorState({
        editor,
        selector: (s) => ({
            active: TOOLBAR_ACTIONS.map((a) => a.isActive(s.editor)),
            enabled: TOOLBAR_ACTIONS.map((a) => a.isEnabled?.(s.editor) ?? true),
        }),
    });
}

interface RovingStop {
    enabled: boolean[];
    stop: number;
    refs: { current: (HTMLButtonElement | null)[] };
    setFocus: (i: number) => void;
    onKeyDown: (ev: KeyboardEvent<HTMLDivElement>) => void;
}

/** Roving tabindex over the enabled buttons: one Tab stop, ←/→/Home/End skip disabled ones. */
function useRovingStop(enabled: boolean[]): RovingStop {
    const [focus, setFocus] = useState(0);
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    // The one Tab stop sits on an enabled button: when the remembered one is disabled, the first enabled one.
    const stop = enabled[focus] ? focus : Math.max(walkEnabled(enabled, 0, 1), 0);
    const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>): void => {
        const move = NAV[ev.key];
        if (!move) return;
        ev.preventDefault();
        const next = walkEnabled(enabled, ...move(stop, enabled.length));
        if (next === -1) return;
        setFocus(next);
        refs.current[next]?.focus();
    };
    return { enabled, stop, refs, setFocus, onKeyDown };
}

/** The formatting toolbar for {@link MarkdownEditor}. */
export function MarkdownToolbar({ editor, controls, disabled, onLink }: MarkdownToolbarProps): JSX.Element {
    const state = useToolbarState(editor);
    const env = platform();
    const { enabled, stop, refs, setFocus, onKeyDown } = useRovingStop(TOOLBAR_ACTIONS.map((_a, i) => !disabled && state?.enabled[i] !== false));
    return (
        <div role="toolbar" aria-label="Formatting" aria-controls={controls} onKeyDown={onKeyDown}
            className="flex flex-nowrap gap-1 overflow-x-auto scroll-px-2 px-1 py-1 border-b border-edge">
            {TOOLBAR_ACTIONS.map((a, i) => (
                <Button key={a.key} ref={(el) => { refs.current[i] = el; }} type="button" variant="ghost" size="sm" iconOnly
                    aria-label={a.label} aria-pressed={!!state?.active[i]} aria-keyshortcuts={ariaShortcut(a.shortcut)}
                    title={actionTitle(a, env)} tabIndex={i === stop ? 0 : -1} disabled={!enabled[i]}
                    data-testid={`md-tool-${a.key}`} onFocus={() => setFocus(i)}
                    className={`shrink-0 ${state?.active[i] ? 'bg-overlay text-foreground' : 'text-muted'}`}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => (a.run === 'link' ? onLink() : a.run(editor))}>
                    <a.icon aria-hidden className="w-5 h-5" />
                </Button>
            ))}
        </div>
    );
}
