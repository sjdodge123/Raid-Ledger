import type { JSX } from 'react';
import { useState, useMemo } from "react";
import { FunnelIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useGamesDiscover } from "../hooks/use-games-discover";
import { useGameSearch } from "../hooks/use-game-search";
import { useAuth, isOperatorOrAdmin } from "../hooks/use-auth";
import { useScrollDirection } from "../hooks/use-scroll-direction";
import { WantToPlayProvider } from "../hooks/use-want-to-play-batch";
import { useGamesPricingBatch } from "../hooks/use-games-pricing-batch";
import { GameCarousel } from "../components/games/GameCarousel";
import { UnifiedGameCard } from "../components/games/unified-game-card";
import { GameLibraryTable } from "../components/admin/GameLibraryTable";
import { GamesMobileToolbar } from "../components/games/games-mobile-toolbar";
import { BottomSheet } from "../components/ui/bottom-sheet";
import { FAB } from "../components/ui/fab";
import { LineupBanner } from "../components/lineups/LineupBanner";
import { AdultContentFilterToggle, ShowHiddenGamesToggle } from "./games/games-helpers";
import { GENRE_FILTERS } from "./games/games-constants";
import type { GameDetailDto, GameDiscoverRowDto, ItadGamePricingDto } from "@raid-ledger/contract";

type GamesTab = "discover" | "manage";

function useGamesPageState() {
  const { user } = useAuth();
  const canManage = isOperatorOrAdmin(user);
  const [activeTab, setActiveTab] = useState<GamesTab>("discover");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);
  const [showHidden, setShowHidden] = useState<'only' | undefined>(undefined);
  const scrollDirection = useScrollDirection();
  const isHeaderHidden = scrollDirection === 'down';
  return { canManage, activeTab, setActiveTab, searchQuery, setSearchQuery, selectedGenres, setSelectedGenres, genreSheetOpen, setGenreSheetOpen, showHidden, setShowHidden, isHeaderHidden };
}

function useGamesData(searchQuery: string, selectedGenres: Set<string>) {
  const { data: discoverData, isLoading: discoverLoading } = useGamesDiscover();
  const { data: searchData, isLoading: searchLoading, isFetching: searchFetching } = useGameSearch(searchQuery, searchQuery.length >= 2);
  const isSearching = searchQuery.length >= 2;
  const activeFilters = GENRE_FILTERS.filter(f => selectedGenres.has(f.key));
  const filteredRows = filterDiscoverRows(discoverData?.rows, activeFilters);
  const searchResults = searchData?.data;
  const searchSource = searchData?.meta?.source;
  const allGameIds = useMemo(() => {
    const ids: number[] = [];
    if (filteredRows) for (const row of filteredRows) for (const game of row.games) ids.push(game.id);
    if (searchResults) for (const game of searchResults) ids.push(game.id);
    return ids;
  }, [filteredRows, searchResults]);
  return { discoverLoading, searchLoading, searchFetching, isSearching, filteredRows, searchResults, searchSource, allGameIds };
}

function filterDiscoverRows(rows: GameDiscoverRowDto[] | undefined, activeFilters: typeof GENRE_FILTERS) {
  return rows
    ?.map((row) => ({
      ...row,
      games: activeFilters.length > 0
        ? row.games.filter((g) => activeFilters.some(f => f.match(g.genres)))
        : row.games,
    }))
    .filter((row) => row.games.length > 0);
}

export function GamesPage() {
  const state = useGamesPageState();
  const data = useGamesData(state.searchQuery, state.selectedGenres);
  return (
    <div className="pb-20 md:pb-0">
      <GamesMobileToolbar activeTab={state.activeTab === "manage" ? "manage" : "discover"} onTabChange={(tab) => state.setActiveTab(tab)} showManageTab={state.canManage} />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <LineupBanner />
        <GamesHeader activeTab={state.activeTab} />
        <AdminTabToggle canManage={state.canManage} activeTab={state.activeTab} onTabChange={state.setActiveTab} />
        <ManageTab canManage={state.canManage} activeTab={state.activeTab} showHidden={state.showHidden} setShowHidden={state.setShowHidden} />
        {state.activeTab === "discover" && (
          <DiscoverTab state={state} data={data} />
        )}
      </div>
      {state.activeTab === "discover" && !data.isSearching && (
        <FAB onClick={() => state.setGenreSheetOpen(true)} icon={FunnelIcon} label="Genre Filter" />
      )}
      <GenreFilterSheet genreSheetOpen={state.genreSheetOpen} onClose={() => state.setGenreSheetOpen(false)} selectedGenres={state.selectedGenres} onGenresChange={state.setSelectedGenres} />
    </div>
  );
}

function ManageTab({ canManage, activeTab, showHidden, setShowHidden }: { canManage: boolean; activeTab: GamesTab; showHidden: 'only' | undefined; setShowHidden: (v: 'only' | undefined) => void }) {
  if (activeTab !== "manage" || !canManage) return null;
  return (
    <>
      <AdultContentFilterToggle />
      <ShowHiddenGamesToggle showHidden={showHidden} onToggle={() => setShowHidden(showHidden === 'only' ? undefined : 'only')} />
      <GameLibraryTable key={showHidden ?? 'default'} showHidden={showHidden} />
    </>
  );
}

function DiscoverTab({ state, data }: { state: ReturnType<typeof useGamesPageState>; data: ReturnType<typeof useGamesData> }) {
  const pricingMap = useGamesPricingBatch(data.allGameIds);
  return (
    <WantToPlayProvider gameIds={data.allGameIds}>
      <SearchBar searchQuery={state.searchQuery} onSearchChange={state.setSearchQuery} isHeaderHidden={state.isHeaderHidden} />
      {!data.isSearching && <DesktopGenrePills selectedGenres={state.selectedGenres} onGenresChange={state.setSelectedGenres} />}
      {data.isSearching ? (
        <SearchResults searchLoading={data.searchLoading} searchResults={data.searchResults} searchSource={data.searchSource} searchQuery={state.searchQuery} pricingMap={pricingMap} />
      ) : (
        <DiscoverContent discoverLoading={data.discoverLoading} filteredRows={data.filteredRows} selectedGenres={state.selectedGenres} pricingMap={pricingMap} />
      )}
    </WantToPlayProvider>
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
    <div className="sticky z-10 bg-surface/95 backdrop-blur-sm pt-2 pb-4 -mx-1 px-1 md:static md:z-auto md:bg-transparent md:backdrop-blur-none md:pt-0 md:pb-0 md:mx-0 md:px-0 mb-6"
      style={{ top: isHeaderHidden ? 75 : 140, transition: 'top 300ms ease-in-out' }}>
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search games..."
          className="w-full pl-12 pr-4 py-3 bg-surface/50 border border-transparent md:border-edge rounded-xl text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" />
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

function SearchLoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (<div key={i} className="animate-pulse"><div className="aspect-[3/4] bg-overlay rounded-xl" /><div className="mt-2 h-4 bg-overlay rounded w-3/4" /></div>))}
    </div>
  );
}

function LocalSearchWarning() {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-yellow-900/30 border border-yellow-700/40 text-yellow-500 text-sm font-medium">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      Showing local results (external search unavailable)
    </div>
  );
}

type PricingMap = Map<number, ItadGamePricingDto | null>;

function SearchResults({ searchLoading, searchResults, searchSource, searchQuery, pricingMap }: {
  searchLoading: boolean; searchResults: GameDetailDto[] | undefined; searchSource: string | undefined; searchQuery: string; pricingMap: PricingMap;
}): JSX.Element {
  if (searchLoading) return <SearchLoadingSkeleton />;
  if (searchResults && searchResults.length > 0) {
    return (
      <>
        {searchSource === 'local' && <LocalSearchWarning />}
        <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {searchResults.map((game) => (<UnifiedGameCard key={game.id} variant="link" game={game} showRating showInfoBar pricing={pricingMap.get(game.id) ?? null} />))}
        </div>
        <div className="md:hidden grid grid-cols-2 gap-4">
          {searchResults.map((game) => (<UnifiedGameCard key={game.id} variant="link" game={game} showRating pricing={pricingMap.get(game.id) ?? null} />))}
        </div>
      </>
    );
  }
  return (
    <div className="text-center py-16">
      <p className="text-muted text-lg">No games found for &ldquo;{searchQuery}&rdquo;</p>
      <p className="text-dim text-sm mt-1">Try a different search term</p>
    </div>
  );
}

function DiscoverLoadingSkeleton() {
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

function DiscoverRows({ filteredRows, pricingMap }: { filteredRows: GameDiscoverRowDto[]; pricingMap: PricingMap }) {
  return (
    <div className="space-y-8">
      <div className="hidden md:block space-y-8">
        {filteredRows.map((row) => (<GameCarousel key={row.slug} category={row.category} games={row.games} pricingMap={pricingMap} />))}
      </div>
      <div className="md:hidden space-y-6">
        {filteredRows.map((row) => (
          <div key={row.slug}>
            <h2 className="text-lg font-semibold text-foreground mb-3">{row.category}</h2>
            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 scroll-pl-4" style={{ scrollbarWidth: 'none' }}>
              {row.games.map((game) => (<div key={game.id} className="min-w-[180px] w-[180px] flex-shrink-0 snap-start"><UnifiedGameCard variant="link" game={game} compact showRating pricing={pricingMap.get(game.id) ?? null} /></div>))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiscoverContent({ discoverLoading, filteredRows, selectedGenres, pricingMap }: {
  discoverLoading: boolean; filteredRows: GameDiscoverRowDto[] | undefined; selectedGenres: Set<string>; pricingMap: PricingMap;
}): JSX.Element {
  if (discoverLoading) return <DiscoverLoadingSkeleton />;
  if (filteredRows && filteredRows.length > 0) return <DiscoverRows filteredRows={filteredRows} pricingMap={pricingMap} />;
  return (
    <div className="text-center py-16">
      <p className="text-muted text-lg">No games in the library yet</p>
      <p className="text-dim text-sm mt-1">{selectedGenres.size > 0 ? "Try selecting a different genre" : "Games will appear here once synced from IGDB"}</p>
    </div>
  );
}

function GenreSheetItem({ genre, isActive, onToggle }: { genre: typeof GENRE_FILTERS[number]; isActive: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={`flex items-center justify-between h-12 px-3 rounded-lg transition-colors ${isActive ? "bg-emerald-600/10 text-emerald-400" : "text-secondary hover:bg-overlay"}`}>
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isActive ? 'bg-emerald-500 border-emerald-500' : 'border-edge'}`}>
          {isActive && (<svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>)}
        </div>
        <span className="text-sm font-medium">{genre.label}</span>
      </div>
    </button>
  );
}

function toggleGenre(selectedGenres: Set<string>, key: string): Set<string> {
  return new Set(selectedGenres.has(key) ? [...selectedGenres].filter(k => k !== key) : [...selectedGenres, key]);
}

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
        {GENRE_FILTERS.map((genre) => (
          <GenreSheetItem key={genre.key} genre={genre} isActive={selectedGenres.has(genre.key)} onToggle={() => onGenresChange(toggleGenre(selectedGenres, genre.key))} />
        ))}
      </div>
    </BottomSheet>
  );
}
