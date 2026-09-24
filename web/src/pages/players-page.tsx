import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useInfinitePlayers } from '../hooks/use-players';
import { usePlayerFilters } from '../hooks/use-player-filters';
import { resolveAvatar, toAvatarUser } from '../lib/avatar';
import { NewMembersSection } from '../components/players/NewMembersSection';
import { MobilePlayerCard } from '../components/players/mobile-player-card';
import { PlayersMobileToolbar } from '../components/players/players-mobile-toolbar';
import { FilterPanelTrigger, FilterPanel } from '../components/ui/filter-panel';
import { PlayerFilters } from '../components/players/player-filters';
import { InfiniteScrollSentinel } from '../components/ui/infinite-scroll-sentinel';
import { PullToRefresh } from '../components/ui/pull-to-refresh';
import { SearchInput } from '../components/ui/search-input';
import type { UserPreviewDto } from '@raid-ledger/contract';

/** Debounced search state for text input. */
function useDebounceSearch() {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    return { search, setSearch, debouncedSearch };
}

function DesktopSearchInput({ search, setSearch }: { search: string; setSearch: (v: string) => void }) {
    return (
        <div className="hidden md:block">
            <SearchInput value={search} onChange={setSearch} placeholder="Search players..." label="Search players" />
        </div>
    );
}

function PlayersLoadingSkeleton() {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="bg-panel border border-edge rounded-lg p-4 animate-pulse"><div className="w-16 h-16 rounded-full bg-overlay mx-auto" /><div className="h-4 w-20 bg-overlay rounded mx-auto mt-3" /></div>
            ))}
        </div>
    );
}

function DesktopPlayerCard({ player }: { player: UserPreviewDto }) {
    const avatar = resolveAvatar(toAvatarUser(player));
    return (
        <Link to={`/users/${player.id}`} className="bg-panel border border-edge rounded-lg p-4 hover:bg-overlay transition-colors text-center group">
            {avatar.url ? <img src={avatar.url} alt={player.username} className="w-16 h-16 rounded-full mx-auto bg-overlay object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} /> : null}
            <div className={`w-16 h-16 rounded-full mx-auto bg-overlay flex items-center justify-center text-2xl text-muted ${avatar.url ? 'hidden' : ''}`}>{player.username.charAt(0).toUpperCase()}</div>
            <div className="mt-3 text-sm font-medium text-foreground group-hover:text-emerald-400 transition-colors truncate">{player.username}</div>
        </Link>
    );
}

function PlayerGrid({ players, debouncedSearch }: { players: UserPreviewDto[]; debouncedSearch: string }) {
    if (players.length === 0) {
        return <div className="text-center py-12 text-muted"><p className="text-lg">No players found</p>{debouncedSearch && <p className="text-sm mt-1">Try a different search term</p>}</div>;
    }
    return (
        <>
            <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-5 gap-4">{players.map((p) => <DesktopPlayerCard key={p.id} player={p} />)}</div>
            <div className="md:hidden grid grid-cols-2 gap-3">{players.map((p) => <MobilePlayerCard key={p.id} player={p} />)}</div>
        </>
    );
}

export function PlayersPage() {
    const { search, setSearch, debouncedSearch } = useDebounceSearch();
    const { filters, setFilter, clearAll, activeFilterCount, apiParams, isOpen, toggleOpen } = usePlayerFilters();
    const { items: players, total, isLoading, isFetchingNextPage, hasNextPage, sentinelRef, refetch } = useInfinitePlayers(debouncedSearch, apiParams);

    return (
        <PullToRefresh onRefresh={refetch}>
            <div className="pb-20 md:pb-0">
                <PlayersMobileToolbar searchQuery={search} onSearchChange={setSearch} hasActiveFilters={activeFilterCount > 0} onFilterToggle={toggleOpen} />
                <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold text-foreground">Players</h1>
                            <FilterPanelTrigger activeCount={activeFilterCount} isOpen={isOpen} onClick={toggleOpen} />
                        </div>
                        <span className="text-sm text-muted">{total} {activeFilterCount > 0 ? 'matching' : 'registered'}</span>
                    </div>
                    <FilterPanel activeFilterCount={activeFilterCount} onClearAll={clearAll} isOpen={isOpen} onToggle={toggleOpen}>
                        <PlayerFilters filters={filters} setFilter={setFilter} />
                    </FilterPanel>
                    {activeFilterCount === 0 && !debouncedSearch && <NewMembersSection />}
                    <DesktopSearchInput search={search} setSearch={setSearch} />
                    {isLoading ? <PlayersLoadingSkeleton /> : <PlayerGrid players={players} debouncedSearch={debouncedSearch} />}
                    {!isLoading && players.length > 0 && <InfiniteScrollSentinel sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} />}
                </div>
            </div>
        </PullToRefresh>
    );
}
