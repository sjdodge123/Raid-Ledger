import { SearchInput } from '../ui/search-input';
import { MobilePageToolbar } from '../layout/mobile-page-toolbar';
import type { GenreOption } from '../../pages/events/genre-filter-helpers';

export type EventsTab = 'upcoming' | 'past' | 'mine' | 'plans';

interface EventsMobileToolbarProps {
    activeTab: EventsTab;
    onTabChange: (tab: EventsTab) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    genreOptions?: GenreOption[];
    selectedGenre?: string;
    onGenreChange?: (genreKey: string) => void;
}

const TABS: { key: EventsTab; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
    { key: 'mine', label: 'My Events' },
    { key: 'plans', label: 'Plans' },
];

function TabButtons({ activeTab, onTabChange }: { activeTab: EventsTab; onTabChange: (tab: EventsTab) => void }) {
    return (
        <div className="flex gap-2">
            {TABS.map(({ key, label }) => (
                <button key={key} type="button" onClick={() => onTabChange(key)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeTab === key ? 'bg-emerald-600 text-white' : 'bg-panel text-muted hover:bg-overlay'
                    }`}>
                    {label}
                </button>
            ))}
        </div>
    );
}

function SearchAndGenreFilter({ searchQuery, onSearchChange, genreOptions, selectedGenre, onGenreChange }: {
    searchQuery: string; onSearchChange: (q: string) => void;
    genreOptions?: GenreOption[]; selectedGenre?: string; onGenreChange?: (key: string) => void;
}) {
    return (
        <div className="flex gap-2">
            <div className="flex-1 min-w-0">
                <SearchInput value={searchQuery} onChange={onSearchChange} placeholder="Search events..." label="Search events" />
            </div>
            {genreOptions && genreOptions.length > 0 && onGenreChange && (
                <select value={selectedGenre ?? ''} onChange={(e) => onGenreChange(e.target.value)}
                    aria-label="Filter by genre"
                    className="max-w-[8rem] truncate px-3 py-2.5 bg-panel/50 border border-edge rounded-lg text-base lg:text-sm text-foreground focus:ring-2 focus:ring-success/80 focus:outline-none">
                    <option value="">All Games</option>
                    {genreOptions.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                </select>
            )}
        </div>
    );
}

/**
 * Mobile toolbar for Events page — filter tabs + search input (ROK-329).
 * ROK-706: Genre-based filter dropdown replaces individual game dropdown.
 */
export function EventsMobileToolbar({
    activeTab, onTabChange, searchQuery, onSearchChange, genreOptions, selectedGenre, onGenreChange,
}: EventsMobileToolbarProps) {
    return (
        <MobilePageToolbar className="space-y-3" aria-label="Events filters">
            <TabButtons activeTab={activeTab} onTabChange={onTabChange} />
            <SearchAndGenreFilter searchQuery={searchQuery} onSearchChange={onSearchChange}
                genreOptions={genreOptions} selectedGenre={selectedGenre} onGenreChange={onGenreChange} />
        </MobilePageToolbar>
    );
}
