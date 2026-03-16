import { MagnifyingGlassIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { MobilePageToolbar } from '../layout/mobile-page-toolbar';

interface PlayersMobileToolbarProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    hasActiveFilters?: boolean;
    onFilterToggle?: () => void;
}

/**
 * Mobile toolbar for Players page — sticky search bar + filter trigger (ROK-329, ROK-821).
 */
export function PlayersMobileToolbar({ searchQuery, onSearchChange, hasActiveFilters = false, onFilterToggle }: PlayersMobileToolbarProps) {
    return (
        <MobilePageToolbar aria-label="Players search">
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search players..."
                        aria-label="Search players"
                        className="w-full pl-10 pr-4 py-2.5 bg-panel/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-muted focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                </div>
                {onFilterToggle && (
                    <MobileFilterButton hasActive={hasActiveFilters} onClick={onFilterToggle} />
                )}
            </div>
        </MobilePageToolbar>
    );
}

/** Funnel icon button for mobile toolbar — dot indicator when filters are active. */
function MobileFilterButton({ hasActive, onClick }: { hasActive: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Filters"
            className="relative flex items-center justify-center w-10 h-10 text-muted hover:text-foreground transition-colors"
        >
            <FunnelIcon className="w-5 h-5" />
            {hasActive && (
                <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full" />
            )}
        </button>
    );
}
