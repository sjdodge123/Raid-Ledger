import type { JSX } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * The compact title row the phone scheduling sheets draw INSIDE `BottomSheet`
 * (ROK-1579 for the game-time check, ROK-1580 for "Find a better time").
 *
 * `BottomSheet`'s house header is `text-lg` with its own padding; these two
 * sheets are full-height (`95vh`) and give their body a definite height, so
 * they trade that header for this shorter row — one recipe, so the two drawers
 * the operator approved as "the same drawer chrome" really are. The negative
 * margins cancel the sheet's content padding so the row spans edge to edge.
 * The caller passes `ariaLabel` (not `title`) to `BottomSheet`, or it would
 * draw both.
 */
export function SheetTitleRow({ title, onClose, testId = 'sheet-title-row' }: {
    title: string; onClose: () => void; testId?: string;
}): JSX.Element {
    return (
        <div
            data-testid={testId}
            className="-mx-4 -mt-4 mb-1 flex items-center justify-between gap-2 border-b border-edge px-4 py-1"
        >
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            <button
                type="button"
                aria-label="Close sheet"
                onClick={onClose}
                className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center text-muted transition-colors hover:text-foreground"
            >
                <XMarkIcon className="h-5 w-5" />
            </button>
        </div>
    );
}
