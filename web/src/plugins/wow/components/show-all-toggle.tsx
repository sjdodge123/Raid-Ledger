/**
 * ROK-2146 (ruling 5): the "Show all N" / "Show fewer" toggle under a list
 * capped by `useRowCap` — a real button with `aria-expanded` pointing at the
 * list it controls. Rendered only when the list is longer than the cap.
 */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';

export function ShowAllToggle({ total, expanded, onToggle, controls }: {
    total: number; expanded: boolean; onToggle: () => void; controls: string;
}): JSX.Element {
    return (
        <Button variant="ghost" size="sm" className="mt-2" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
            {expanded ? 'Show fewer' : `Show all ${total}`}
        </Button>
    );
}
