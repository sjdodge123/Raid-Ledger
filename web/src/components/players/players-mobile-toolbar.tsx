import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { MobilePageToolbar } from '../layout/mobile-page-toolbar';

interface PlayersMobileToolbarProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
}

/**
 * Mobile toolbar for Players page — sticky search bar (ROK-329).
 */
export function PlayersMobileToolbar({ searchQuery, onSearchChange }: PlayersMobileToolbarProps) {
    return (
        <MobilePageToolbar aria-label="Players search">
            <div className="relative">
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
        </MobilePageToolbar>
    );
}
