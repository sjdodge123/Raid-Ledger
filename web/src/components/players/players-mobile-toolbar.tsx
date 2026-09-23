import { FunnelIcon } from '@heroicons/react/24/outline';
import { SearchInput } from '../ui/search-input';
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
                <div className="flex-1">
                    <SearchInput value={searchQuery} onChange={onSearchChange} placeholder="Search players..." label="Search players" />
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
