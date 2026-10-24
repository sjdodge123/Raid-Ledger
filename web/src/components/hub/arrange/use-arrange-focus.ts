/**
 * ROK-1918 — focus follows the moved row (spec §2.4, design-system §4.28).
 * React reorders the `<li>`s by moving DOM nodes, which drops focus from a
 * moved row; and a row that reaches an end disables the arrow just pressed.
 * `request` records which row/control should hold focus once the new order has
 * rendered; the layout effect then focuses it — the same arrow, the other
 * arrow when that one is now disabled, or the row itself after a drop.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/** `up` / `down` = that Move button; `row` = the `<li>` (after a drag drop). */
export type ArrangeFocusTarget = 'up' | 'down' | 'row';

interface Pending {
    id: string;
    target: ArrangeFocusTarget;
}

function rowElement(list: HTMLElement, id: string): HTMLElement | undefined {
    return Array.from(list.children).find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.arrangeId === id);
}

function button(row: HTMLElement, action: 'up' | 'down'): HTMLButtonElement | null {
    return row.querySelector<HTMLButtonElement>(`button[data-arrange-action="${action}"]`);
}

/** The pressed arrow, else the opposite one (end of the list), else the row. */
function focusTarget(row: HTMLElement, target: ArrangeFocusTarget): HTMLElement {
    if (target === 'row') return row;
    const other = target === 'up' ? 'down' : 'up';
    const candidates = [button(row, target), button(row, other)];
    return candidates.find((b): b is HTMLButtonElement => b !== null && !b.disabled) ?? row;
}

/** `bindList` is a callback ref for the `<ol>` (a plain function, so the hook's result can be spread in render). */
export function useArrangeFocus(order: unknown): { bindList: (el: HTMLOListElement | null) => void; request: (id: string, target: ArrangeFocusTarget) => void } {
    const listRef = useRef<HTMLOListElement | null>(null);
    const bindList = useCallback((el: HTMLOListElement | null) => { listRef.current = el; }, []);
    const pending = useRef<Pending | null>(null);
    const request = useCallback((id: string, target: ArrangeFocusTarget) => { pending.current = { id, target }; }, []);
    useLayoutEffect(() => {
        const want = pending.current;
        const list = listRef.current;
        if (want === null || list === null) return;
        pending.current = null;
        const row = rowElement(list, want.id);
        if (row) focusTarget(row, want.target).focus();
    }, [order]);
    return { bindList, request };
}
