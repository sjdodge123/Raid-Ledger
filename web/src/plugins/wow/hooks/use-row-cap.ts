/**
 * ROK-2146 (ruling 5): a long character-page list shows its first
 * `LIST_ROW_CAP` rows until the viewer asks for all of them. Pair with
 * `ShowAllToggle` (components/show-all-toggle.tsx).
 */
import { useState } from 'react';

export const LIST_ROW_CAP = 5;

/** The visible slice of `rows` plus the toggle state; `capped` is false for a list of `cap` rows or fewer. */
export function useRowCap<T>(rows: readonly T[], cap: number = LIST_ROW_CAP) {
    const [expanded, setExpanded] = useState(false);
    const capped = rows.length > cap;
    return {
        visible: capped && !expanded ? rows.slice(0, cap) : rows,
        capped,
        expanded,
        toggle: () => setExpanded((v) => !v),
    };
}
