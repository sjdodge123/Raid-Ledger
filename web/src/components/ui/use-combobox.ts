/**
 * useCombobox — state and the keyboard contract for `Combobox` (ROK-1646,
 * WAI-ARIA 1.2 combobox pattern; operator ruling: in-house, no library).
 *
 * ArrowDown / ArrowUp open the popup (on the first / last option) and then
 * move, wrapping. Home / End jump while open. Enter picks the active option.
 * Escape closes an open popup; on a closed one it clears the text and the
 * value. Tab commits the active option (focus still moves on) or just closes.
 * Escape is stopped only when it did something, so a surrounding Modal or
 * BottomSheet closes on the NEXT press, not this one. Every key is ignored
 * while an IME composition is in progress (Enter confirms the candidate).
 */
import { useId, useState, type KeyboardEvent } from 'react';
import type { ComboboxProps, ComboboxStatus } from './combobox-types';

type KeyEvent = KeyboardEvent<HTMLInputElement>;

export interface ComboboxController<T> {
    open: boolean;
    text: string;
    items: T[];
    activeIndex: number;
    listboxId: string;
    status?: ComboboxStatus;
    optionId: (index: number) => string;
    setActive: (index: number) => void;
    select: (index: number) => void;
    close: () => void;
    /** Open the popup without moving the highlight (`openOnFocus`). */
    show: () => void;
    onInputChange: (text: string) => void;
    onKeyDown: (e: KeyEvent) => void;
}

/** The input text: controlled via `inputValue`, else owned, and re-synced when `value` changes. */
function useComboboxText<T>(p: ComboboxProps<T>): [string, (s: string) => void] {
    const [own, setOwn] = useState(() => (p.value ? p.getLabel(p.value) : ''));
    const key = p.value ? p.getKey(p.value) : null;
    const [seenKey, setSeenKey] = useState(key);
    if (key !== seenKey) {
        setSeenKey(key);
        if (p.inputValue === undefined) setOwn(p.value ? p.getLabel(p.value) : '');
    }
    const setText = (s: string): void => {
        if (p.inputValue === undefined) setOwn(s);
        p.onInputChange?.(s);
    };
    return [p.inputValue ?? own, setText];
}

function statusOf<T>(p: ComboboxProps<T>, count: number): ComboboxStatus | undefined {
    if (p.errorText) return { text: p.errorText, tone: 'danger' };
    if (p.loading) return { text: p.loadingText ?? 'Loading…', tone: 'muted' };
    if (count === 0) return { text: p.emptyText ?? 'No results', tone: 'muted' };
    return undefined;
}

function wrap(i: number, d: 1 | -1, n: number): number {
    if (n === 0) return -1;
    if (i < 0) return d > 0 ? 0 : n - 1;
    return (i + d + n) % n;
}

interface Internals {
    open: boolean; n: number; activeIndex: number; text: string; hasValue: boolean;
    setOpen: (o: boolean) => void; setActive: (i: number) => void;
    select: (i: number) => void; close: () => void; clear: () => void;
}

function step(c: Internals, d: 1 | -1): void {
    if (!c.open) {
        c.setOpen(true);
        c.setActive(wrap(-1, d, c.n));
        return;
    }
    c.setActive(wrap(c.activeIndex, d, c.n));
}

function escape(c: Internals, e: KeyEvent): void {
    if (!c.open && c.text === '' && !c.hasValue) return; // let a Modal / BottomSheet have it
    e.preventDefault();
    e.stopPropagation();
    if (c.open) c.close();
    else c.clear();
}

function handleKey(c: Internals, e: KeyEvent): void {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // an IME is confirming a candidate
    const jump = (i: number): void => { if (c.open && c.n > 0) { e.preventDefault(); c.setActive(i); } };
    const commit = c.open && c.activeIndex >= 0;
    switch (e.key) {
        case 'ArrowDown': e.preventDefault(); step(c, 1); break;
        case 'ArrowUp': e.preventDefault(); step(c, -1); break;
        case 'Home': jump(0); break;
        case 'End': jump(c.n - 1); break;
        case 'Enter': if (commit) { e.preventDefault(); c.select(c.activeIndex); } break;
        case 'Escape': escape(c, e); break;
        case 'Tab': if (commit) c.select(c.activeIndex); else c.close(); break;
    }
}

/** Combobox state + handlers. The view (`combobox.tsx`) owns the DOM. */
export function useCombobox<T>(p: ComboboxProps<T>): ComboboxController<T> {
    const listboxId = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [text, setText] = useComboboxText(p);
    const items = p.loading || p.errorText ? [] : p.options;
    const activeIndex = open && active < items.length ? active : -1;
    const close = (): void => { setOpen(false); setActive(-1); };
    const select = (i: number): void => {
        const o = items[i];
        if (o === undefined) return;
        p.onChange(o);
        setText(p.getLabel(o));
        close();
    };
    const clear = (): void => { setText(''); if (p.value !== null) p.onChange(null); };
    const c: Internals = { open, n: items.length, activeIndex, text, hasValue: p.value !== null, setOpen, setActive, select, close, clear };
    return {
        open, text, items, activeIndex, listboxId, status: statusOf(p, items.length),
        optionId: (i) => `${listboxId}-option-${i}`,
        setActive, select, close, show: () => setOpen(true),
        onInputChange: (s) => { setText(s); setOpen(true); setActive(-1); },
        onKeyDown: (e) => handleKey(c, e),
    };
}
