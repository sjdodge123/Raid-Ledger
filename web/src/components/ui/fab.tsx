import { PlusIcon } from '@heroicons/react/24/solid';
import { Z_INDEX } from '../../lib/z-index';
import { useCreateFabBottom } from './fab-position';

interface FABProps {
    onClick: () => void;
    icon?: React.ComponentType<{ className?: string }>;
    label?: string;
}

/**
 * A page's primary CREATE action on phones (`md:hidden`, emerald). One per page.
 *
 * Filters never use this: a page that filters gets the neutral Filters FAB
 * through `FilterEntry` (filter-entry.tsx, ROK-1659), `lg:hidden`. On a page
 * with both, this FAB keeps the bottom slot (72, or 16 while the tab bar hides)
 * and the Filters FAB stacks directly above it (`stackAboveCreate`: 140 / 84,
 * same `right-4` edge, 12px gap). The page's bottom padding must clear the
 * whole stack. Offsets and the rule: `fab-position.ts`.
 */
export function FAB({ onClick, icon: Icon = PlusIcon, label }: FABProps) {
    const bottom = useCreateFabBottom();

    return (
        <button
            onClick={onClick}
            aria-label={label || 'Create'}
            className="fixed right-4 w-14 h-14 bg-emerald-600 text-white rounded-full shadow-lg shadow-emerald-500/25 hover:bg-emerald-500 active:scale-95 transition-all duration-200 flex items-center justify-center md:hidden"
            style={{ zIndex: Z_INDEX.FAB, bottom }}
        >
            <Icon className="w-6 h-6" />
        </button>
    );
}
