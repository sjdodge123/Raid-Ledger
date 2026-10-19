/**
 * ROK-1836 — roving tabindex for a `role="grid"`: one tab stop; arrow keys move
 * across cells, Home / End jump to the row's ends. Focusable cells carry
 * `data-rc="row,col"`; the hook reads them from the event, so it never holds refs.
 */
import {
    useCallback,
    useState,
    type FocusEvent,
    type KeyboardEvent,
} from 'react';

export interface GridCell {
    r: number;
    c: number;
}

type Move = (p: GridCell, rows: number, cols: number) => GridCell;

const MOVES: Readonly<Record<string, Move>> = {
    ArrowRight: ({ r, c }, _rows, cols) => ({
        r,
        c: Math.min(cols - 1, c + 1),
    }),
    ArrowLeft: ({ r, c }) => ({ r, c: Math.max(0, c - 1) }),
    ArrowDown: ({ r, c }, rows) => ({ r: Math.min(rows - 1, r + 1), c }),
    ArrowUp: ({ r, c }) => ({ r: Math.max(0, r - 1), c }),
    Home: ({ r }) => ({ r, c: 0 }),
    End: ({ r }, _rows, cols) => ({ r, c: cols - 1 }),
};

/** The cell a key moves to (clamped at the edges), or null for a key the grid does not own. */
export function nextGridCell(
    key: string,
    from: GridCell,
    rows: number,
    cols: number,
): GridCell | null {
    const move = MOVES[key];
    return move ? move(from, rows, cols) : null;
}

function cellOf(target: EventTarget): GridCell | null {
    if (!(target instanceof HTMLElement)) return null;
    const rc = target.closest<HTMLElement>('[data-rc]')?.dataset['rc'];
    const [r, c] = (rc ?? '').split(',').map(Number);
    if (r === undefined || c === undefined || Number.isNaN(r + c)) return null;
    return { r, c };
}

export function useRovingGrid(rows: number, cols: number) {
    const [active, setActive] = useState<GridCell>({ r: 0, c: 0 });
    const onKeyDown = useCallback(
        (e: KeyboardEvent<HTMLElement>) => {
            const from = cellOf(e.target);
            const to = from && nextGridCell(e.key, from, rows, cols);
            if (!to) return;
            e.preventDefault();
            e.currentTarget
                .querySelector<HTMLElement>(`[data-rc="${to.r},${to.c}"]`)
                ?.focus();
            setActive(to);
        },
        [rows, cols],
    );
    const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
        const at = cellOf(e.target);
        if (at) setActive(at);
    }, []);
    const tabIndexFor = (r: number, c: number): number =>
        r === active.r && c === active.c ? 0 : -1;
    return { tabIndexFor, gridProps: { onKeyDown, onFocus } };
}
