import type { JSX } from 'react';
import { useState, useMemo } from "react";
import { FunnelIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useGamesDiscover } from "../hooks/use-games-discover";
import { useGameSearch } from "../hooks/use-game-search";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { useAuth, isOperatorOrAdmin } from "../hooks/use-auth";
import { useScrollDirection } from "../hooks/use-scroll-direction";
import { WantToPlayProvider } from "../hooks/use-want-to-play-batch";
import { GameCarousel } from "../components/games/GameCarousel";
import { GameCard } from "../components/games/GameCard";
import { MobileGameCard } from "../components/games/mobile-game-card";
import { GameLibraryTable } from "../components/admin/GameLibraryTable";
import { GamesMobileToolbar } from "../components/games/games-mobile-toolbar";
import { BottomSheet } from "../components/ui/bottom-sheet";
import { FAB } from "../components/ui/fab";
import { AdultContentFilterToggle, ShowHiddenGamesToggle } from "./games/games-helpers";
import { GENRE_FILTERS } from "./games/games-constants";
import type { GameDetailDto, GameDiscoverRowDto } from "@raid-ledger/contract";

type GamesTab = "discover" | "manage";

// eslint-disable-next-line max-lines-per-function
export function GamesPage() {
  const { user } = useAuth();
  const canManage = isOperatorOrAdmin(user);
  const [activeTab, setActiveTab] = useState<GamesTab>("discover");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);
  const [showHidden, setShowHidden] = useState<'only' | undefined>(undefined);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const scrollDirection = useScrollDirection();
  const isHeaderHidden = scrollDirection === 'down';

  const { data: discoverData, isLoading: discoverLoading } = useGamesDiscover();
  const { data: searchData, isLoading: searchLoading } = useGameSearch(debouncedSearch, debouncedSearch.length >= 2);
  const isSearching = debouncedSearch.length >= 2;

  const activeFilters = GENRE_FILTERS.filter(f => selectedGenres.has(f.key));
  const filteredRows = discoverData?.rows
    ?.map((row) => ({
      ...row,
      games: activeFilters.length > 0
        ? row.games.filter((g) => activeFilters.some(f => f.match(g.genres)))
        : row.games,
    }))
    .filter((row) => row.games.length > 0);

  const searchResults = searchData?.data;
  const searchSource = searchData?.meta?.source;

  const allGameIds = useMemo(() => {
    const ids: number[] = [];
    if (filteredRows) for (const row of filteredRows) for (const game of row.games) ids.push(game.id);
    if (searchResults) for (const game of searchResults) ids.push(game.id);
    return ids;
  }, [filteredRows, searchResults]);

  return (
    <div className="pb-20 md:pb-0">
      <GamesMobileToolbar activeTab={activeTab === "manage" ? "manage" : "discover"} onTabChange={(tab) => setActiveTab(tab)} showManageTab={canManage} />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <GamesHeader activeTab={activeTab} />
        <AdminTabToggle canManage={canManage} activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "manage" && canManage && (
          <>
            <AdultContentFilterToggle />
            <ShowHiddenGamesToggle showHidden={showHidden} onToggle={() => setShowHidden(showHidden === 'only' ? undefined : 'only')} />
            <GameLibraryTable key={showHidden ?? 'default'} showHidden={showHidden} />
          </>
        )}

        {activeTab === "discover" && (
          <WantToPlayProvider gameIds={allGameIds}>
            <SearchBar searchQuery={searchQuery} onSearchChange={setSearchQuery} isHeaderHidden={isHeaderHidden} />
            {!isSearching && <DesktopGenrePills selectedGenres={selectedGenres} onGenresChange={setSelectedGenres} />}
            {isSearching ? (
              <SearchResults searchLoading={searchLoading} searchResults={searchResults} searchSource={searchSource} debouncedSearch={debouncedSearch} />
            ) : (
              <DiscoverContent discoverLoading={discoverLoading} filteredRows={filteredRows} selectedGenres={selectedGenres} />
            )}
          </WantToPlayProvider>
        )}
      </div>

      {activeTab === "discover" && !isSearching && (
        <FAB onClick={() => setGenreSheetOpen(true)} icon={FunnelIcon} label="Genre Filter" />
      )}
      <GenreFilterSheet genreSheetOpen={genreSheetOpen} onClose={() => setGenreSheetOpen(false)} selectedGenres={selectedGenres} onGenresChange={setSelectedGenres} />
    </div>
  );
}

function GamesHeader({ activeTab }: { activeTab: GamesTab }): JSX.Element {
  return (
    <div className="hidden md:block mb-6">
      <h1 className="text-3xl font-bold text-foreground">Game Library</h1>
      <p className="text-muted mt-1">
        {activeTab === "manage" ? "Search, remove, and manage cached games" : "Discover games, see what your community is playing, and find live streams"}
      </p>
    </div>
  );
}

function AdminTabToggle({ canManage, activeTab, onTabChange }: { canManage: boolean; activeTab: GamesTab; onTabChange: (tab: GamesTab) => void }): JSX.Element | null {
  if (!canManage) return null;
  return (
    <div className="hidden md:flex rounded-lg bg-panel/50 border border-edge p-1 w-fit mb-6">
      {(["discover", "manage"] as const).map((tab) => (
        <button key={tab} type="button" onClick={() => onTabChange(tab)}
          className={`px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${activeTab === tab ? "bg-overlay text-foreground" : "text-muted hover:text-secondary"}`}>
          {tab === "discover" ? "Discover" : "Manage"}
        </button>
      ))}
    </div>
  );
}

function SearchBar({ searchQuery, onSearchChange, isHeaderHidden }: { searchQuery: string; onSearchChange: (q: string) => void; isHeaderHidden: boolean }): JSX.Element {
  return (
    <div className="sticky z-10 bg-surface/95 backdrop-blur-sm pb-4 -mx-1 px-1 md:static md:z-auto md:bg-transparent md:backdrop-blur-none md:pb-0 md:mx-0 md:px-0 mb-6"
      style={{ top: isHeaderHidden ? 75 : 140, transition: 'top 300ms ease-in-out' }}>
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search games..."
          className="w-full pl-12 pr-4 py-3 bg-surface/50 border border-edge rounded-xl text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" />
        {searchQuery && (
          <button onClick={() => onSearchChange("")} className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-dim hover:text-foreground transition-colors" aria-label="Clear search">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function DesktopGenrePills({ selectedGenres, onGenresChange }: { selectedGenres: Set<string>; onGenresChange: (s: Set<string>) => void }): JSX.Element {
  return (
    <div className="hidden md:flex gap-2 mb-8 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
      <button onClick={() => onGenresChange(new Set())}
        className={`px-3 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedGenres.size === 0 ? "bg-emerald-600 text-white" : "bg-panel text-secondary hover:bg-overlay"}`}>
        All
      </button>
      {GENRE_FILTERS.map((genre) => {
        const isActive = selectedGenres.has(genre.key);
        return (
          <button key={genre.key} onClick={() => {
            onGenresChange(new Set(isActive ? [...selectedGenres].filter(k => k !== genre.key) : [...selectedGenres, genre.key]));
          }} className={`px-3 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${isActive ? "bg-emerald-600 text-white" : "bg-panel text-secondary hover:bg-overlay"}`}>
            {genre.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchResults({ searchLoading, searchResults, searchSource, debouncedSearch }: {
  searchLoading: boolean; searchResults: GameDetailDto[] | undefined; searchSource: string | undefined; debouncedSearch: string;
}): JSX.Element {
  if (searchLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (<div key={i} className="animate-pulse"><div className="aspect-[3/4] bg-overlay rounded-xl" /><div className="mt-2 h-4 bg-overlay rounded w-3/4" /></div>))}
      </div>
    );
  }
  if (searchResults && searchResults.length > 0) {
    return (
      <>
        {searchSource === 'local' && (
          <div className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-yellow-900/30 border border-yellow-700/40 text-yellow-500 text-sm font-medium">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Showing local results (external search unavailable)
          </div>
        )}
        <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {searchResults.map((game) => (<GameCard key={game.id} game={game} />))}
        </div>
        <div className="md:hidden grid grid-cols-2 gap-3">
          {searchResults.map((game) => (<MobileGameCard key={game.id} game={game} />))}
        </div>
      </>
    );
  }
  return (
    <div className="text-center py-16">
      <p className="text-muted text-lg">No games found for &ldquo;{debouncedSearch}&rdquo;</p>
      <p className="text-dim text-sm mt-1">Try a different search term</p>
    </div>
  );
}

// eslint-disable-next-line max-lines-per-function
function DiscoverContent({ discoverLoading, filteredRows, selectedGenres }: {
  discoverLoading: boolean; filteredRows: GameDiscoverRowDto[] | undefined; selectedGenres: Set<string>;
}): JSX.Element {
  if (discoverLoading) {
    return (
      <div className="space-y-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse"><div className="h-6 bg-overlay rounded w-48 mb-3" /><div className="flex gap-4">
            {Array.from({ length: 6 }).map((_, j) => (<div key={j} className="w-[180px] flex-shrink-0"><div className="aspect-[3/4] bg-overlay rounded-xl" /></div>))}
          </div></div>
        ))}
      </div>
    );
  }
  if (filteredRows && filteredRows.length > 0) {
    return (
      <div className="space-y-8">
        <div className="hidden md:block space-y-8">
          {filteredRows.map((row) => (<GameCarousel key={row.slug} category={row.category} games={row.games} />))}
        </div>
        <div className="md:hidden space-y-6">
          {filteredRows.map((row) => (
            <div key={row.slug}>
              <h2 className="text-lg font-semibold text-foreground mb-3">{row.category}</h2>
              <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2" style={{ scrollbarWidth: 'none' }}>
                {row.games.map((game) => (<div key={game.id} className="w-[140px] flex-shrink-0 snap-start"><MobileGameCard game={game} /></div>))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="text-center py-16">
      <p className="text-muted text-lg">No games in the library yet</p>
      <p className="text-dim text-sm mt-1">{selectedGenres.size > 0 ? "Try selecting a different genre" : "Games will appear here once synced from IGDB"}</p>
    </div>
  );
}

// eslint-disable-next-line max-lines-per-function
function GenreFilterSheet({ genreSheetOpen, onClose, selectedGenres, onGenresChange }: {
  genreSheetOpen: boolean; onClose: () => void; selectedGenres: Set<string>; onGenresChange: (s: Set<string>) => void;
}): JSX.Element {
  return (
    <BottomSheet isOpen={genreSheetOpen} onClose={onClose} title="Genre Filter">
      <div className="flex flex-col">
        <button onClick={() => onGenresChange(new Set())}
          className={`flex items-center justify-between h-12 px-3 rounded-lg transition-colors ${selectedGenres.size === 0 ? "bg-emerald-600/10 text-emerald-400" : "text-secondary hover:bg-overlay"}`}>
          <div className="flex items-center gap-3">
            {selectedGenres.size === 0 ? <CheckIcon className="w-5 h-5 text-emerald-400" /> : <span className="w-5" />}
            <span className="text-sm font-medium">All</span>
          </div>
        </button>
        {GENRE_FILTERS.map((genre) => {
          const isActive = selectedGenres.has(genre.key);
          return (
            <button key={genre.key} onClick={() => {
              onGenresChange(new Set(isActive ? [...selectedGenres].filter(k => k !== genre.key) : [...selectedGenres, genre.key]));
            }} className={`flex items-center justify-between h-12 px-3 rounded-lg transition-colors ${isActive ? "bg-emerald-600/10 text-emerald-400" : "text-secondary hover:bg-overlay"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isActive ? 'bg-emerald-500 border-emerald-500' : 'border-edge'}`}>
                  {isActive && (<svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>)}
                </div>
                <span className="text-sm font-medium">{genre.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
