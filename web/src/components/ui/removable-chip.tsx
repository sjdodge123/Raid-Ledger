/**
 * Removable selection chip (design-system.md §4.3 "removable selection chip",
 * ROK-1654; promoted to `components/ui/` by its second adopter, ROK-2027).
 *
 * A `<span>` pill showing something already picked, not a button: no
 * `aria-pressed`, not focusable. Its only control is the flush-right 44px
 * ghost icon Button named by `removeLabel`, so a screen reader hears
 * "Remove Deadmines, button" and tests query that name. Tokens only — it
 * flips with `success` between the dark and light families.
 */
import type { JSX } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from './button';

export const REMOVABLE_CHIP_CLASS =
    'inline-flex items-center gap-2 pl-3 min-h-[44px] rounded-full bg-success/10 border border-success/30 text-sm font-medium text-success';

export interface RemovableChipProps {
    /** The picked thing's visible name. */
    label: string;
    /** The Remove button's accessible name, e.g. "Remove Deadmines". */
    removeLabel: string;
    onRemove: () => void;
    /** Optional secondary text after the label (e.g. a level range), `text-xs text-muted`. */
    detail?: string;
    testId?: string;
}

export function RemovableChip({ label, removeLabel, onRemove, detail, testId }: RemovableChipProps): JSX.Element {
    return (
        <span className={REMOVABLE_CHIP_CLASS} data-testid={testId}>
            {label}
            {detail !== undefined && <span className="text-xs text-muted">{detail}</span>}
            <Button variant="ghost" iconOnly aria-label={removeLabel} onClick={onRemove}>
                <XMarkIcon className="w-4 h-4" aria-hidden="true" />
            </Button>
        </span>
    );
}
