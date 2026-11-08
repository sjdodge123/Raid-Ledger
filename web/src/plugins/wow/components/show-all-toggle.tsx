/**
 * ROK-2146 (ruling 5): a long character-page list shows its first
 * `LIST_ROW_CAP` rows, then a "Show all N" / "Show fewer" toggle — a real
 * button with `aria-expanded` pointing at the list it controls. A list of
 * `LIST_ROW_CAP` rows or fewer shows every row and no toggle.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../../components/ui/button';

export const LIST_ROW_CAP = 5;

/** The visible slice of `rows` plus the toggle state. */
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

/** The "Show all N" / "Show fewer" button under a capped list. */
export function ShowAllToggle({ total, expanded, onToggle, controls }: {
    total: number; expanded: boolean; onToggle: () => void; controls: string;
}): JSX.Element {
    return (
        <Button variant="ghost" size="sm" className="mt-2" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
            {expanded ? 'Show fewer' : `Show all ${total}`}
        </Button>
    );
}
