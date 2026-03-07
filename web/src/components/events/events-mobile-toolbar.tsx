import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { MobilePageToolbar } from '../layout/mobile-page-toolbar';

export type EventsTab = 'upcoming' | 'past' | 'mine' | 'plans';

interface GameOption {
    id: number;
    name: string;
}

interface EventsMobileToolbarProps {
    activeTab: EventsTab;
    onTabChange: (tab: EventsTab) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    games?: GameOption[];
    selectedGameId?: string;
    onGameChange?: (gameId: string) => void;
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

function SearchAndGameFilter({ searchQuery, onSearchChange, games, selectedGameId, onGameChange }: {
    searchQuery: string; onSearchChange: (q: string) => void;
    games?: GameOption[]; selectedGameId?: string; onGameChange?: (id: string) => void;
}) {
    return (
        <div className="flex gap-2">
            <div className="relative flex-1">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search events..." aria-label="Search events"
                    className="w-full pl-10 pr-4 py-2.5 bg-panel/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-muted focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
            </div>
            {games && games.length > 1 && onGameChange && (
                <select value={selectedGameId ?? ''} onChange={(e) => onGameChange(e.target.value)}
                    aria-label="Filter by game"
                    className="px-3 py-2.5 bg-panel/50 border border-edge rounded-lg text-sm text-foreground focus:ring-2 focus:ring-emerald-500 focus:outline-none">
                    <option value="">All Games</option>
                    {games.map((game) => <option key={game.id} value={String(game.id)}>{game.name}</option>)}
                </select>
            )}
        </div>
    );
}

/**
 * Mobile toolbar for Events page — filter tabs + search input (ROK-329).
 */
export function EventsMobileToolbar({
    activeTab, onTabChange, searchQuery, onSearchChange, games, selectedGameId, onGameChange,
}: EventsMobileToolbarProps) {
    return (
        <MobilePageToolbar className="space-y-3" aria-label="Events filters">
            <TabButtons activeTab={activeTab} onTabChange={onTabChange} />
            <SearchAndGameFilter searchQuery={searchQuery} onSearchChange={onSearchChange}
                games={games} selectedGameId={selectedGameId} onGameChange={onGameChange} />
        </MobilePageToolbar>
    );
}
