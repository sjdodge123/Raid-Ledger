import type { JSX, ReactNode } from 'react';
import { useState, useMemo } from "react";
import { useGamesDiscover } from "../hooks/use-games-discover";
import { useGameSearch } from "../hooks/use-game-search";
import { useAuth, isOperatorOrAdmin } from "../hooks/use-auth";
import { useScrollDirection } from "../hooks/use-scroll-direction";
import { WantToPlayProvider } from "../hooks/use-want-to-play-batch";
import { useGamesPricingBatch } from "../hooks/use-games-pricing-batch";
import { UnifiedGameCard } from "../components/games/unified-game-card";
import { GameLibraryTable } from "../components/admin/GameLibraryTable";
import { GamesMobileToolbar } from "../components/games/games-mobile-toolbar";
import { FilterEntryTrigger } from "../components/ui/filter-entry";
import { SearchInput } from "../components/ui/search-input";
import { LineupBanner } from "../components/lineups/LineupBanner";
import { LfgGroupsProvider } from "../hooks/lfg-groups-provider";
import { LfgHeartedPrompt } from "../components/lfg/lfg-hearted-prompt";
import { LfgLookingGrid } from "./games/lfg-looking-grid";
import { useTileGameIds } from "./games/use-tile-game-ids";
import { useLfgFilterParam } from "./games/use-lfg-filter-param";
import { useSearchQueryParam, MAX_SEARCH_QUERY_LENGTH } from "./games/use-search-query-param";
import { AdultContentFilterToggle, ShowHiddenGamesToggle } from "./games/games-helpers";
import { GENRE_FILTERS } from "./games/games-constants";
import { GamesFilterPanel } from "./games/games-filter-panel";
import { useGamesFilterCount } from "./games/use-games-filters";
import { applyCoopFilters, hasAnyCoopData, EMPTY_COOP_FILTERS, type CoopFilterState } from "./games/coop-filter.helpers";
import { useCoopFilterState } from "./games/use-coop-filter-state";
import { gamesResultCount, formatGamesCount } from "./games/games-result-count";
import { useMediaQuery } from "../hooks/use-media-query";
import { DESKTOP_MQ } from "../lib/breakpoints";
import { useLibraryFilterParams } from "./games/use-library-filter-params";
import { applyLibraryFilters, type LibraryFilterState } from "./games/library-filter.helpers";
import { DiscoverContent, type PricingMap } from "./games-page-discover";
import type { GameDetailDto, GameDiscoverRowDto } from "@raid-ledger/contract";

type GamesTab = "discover" | "manage";

function useGamesPageState() {
  const { user } = useAuth();
  const canManage = isOperatorOrAdmin(user);
  const [activeTab, setActiveTab] = useState<GamesTab>("discover");
  // ROK-1615: the box is URL state like `lfg` / `genres` / `players`, so
  // `/games?q=<term>` opens already searching and a search is shareable.
  const { searchQuery, setSearchQuery } = useSearchQueryParam();
  // ROK-1525: the genre row is URL state like `lfg` / `players` / `owners`, so
  // a shared link reproduces the whole filtered view. The surface is unchanged —
  // consumers still get a Set plus a replace-the-selection setter.
  const { selectedGenres, setSelectedGenres } = useLibraryFilterParams();
  // ROK-1659: ONE filter entry (toolbar funnel ≥1024px, Filters FAB below)
  // replaces the chip rows, the genre pills and the genre-only sheet.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showHidden, setShowHidden] = useState<'only' | undefined>(undefined);
  // ROK-1402: client-side co-op predicates over the already-fetched rows.
  // sessionStorage-backed so a game-detail round trip doesn't drop the filters.
  const [coopFilters, setCoopFilters] = useCoopFilterState();
  const scrollDirection = useScrollDirection();
  const isHeaderHidden = scrollDirection === 'down';
  return { canManage, activeTab, setActiveTab, searchQuery, setSearchQuery, selectedGenres, setSelectedGenres, filtersOpen, setFiltersOpen, showHidden, setShowHidden, isHeaderHidden, coopFilters, setCoopFilters };
}

// Computed over RAW rows (pre-filter) so the section doesn't vanish while a
// filter is active and has narrowed the grid down to nothing.
function useCoopDataAvailable(rows: GameDiscoverRowDto[] | undefined, searchRows: GameDetailDto[] | undefined): boolean {
  return useMemo(
    () => hasAnyCoopData([...(rows?.flatMap((row) => row.games) ?? []), ...(searchRows ?? [])]),
    [rows, searchRows],
  );
}

function useGamesData(searchQuery: string, selectedGenres: Set<string>, coopFilters: CoopFilterState) {
  const { data: discoverData, isLoading: discoverLoading } = useGamesDiscover();
  const { data: searchData, isLoading: searchLoading } = useGameSearch(searchQuery, searchQuery.length >= 2);
  const isSearching = searchQuery.length >= 2;
  const activeFilters = GENRE_FILTERS.filter(f => selectedGenres.has(f.key));
  // ROK-1525: the player-count / ownership predicates are URL-state and read
  // IGDB fields, so they AND with the genre row and the co-op filters as an
  // independent chain rather than being folded into either one.
  const { filters: libraryFilters, isLibraryFiltered, clearLibraryFilters } = useLibraryFilterParams();
  const coopDataAvailable = useCoopDataAvailable(discoverData?.rows, searchData?.data);
  // Dormant page ⇒ no controls are on screen, so a filter restored from
  // sessionStorage must not invisibly empty a grid the user cannot unfilter.
  const effectiveCoopFilters = coopDataAvailable ? coopFilters : EMPTY_COOP_FILTERS;
  const filteredRows = filterDiscoverRows(discoverData?.rows, activeFilters, effectiveCoopFilters, libraryFilters);
  const searchResults = searchData?.data
    ? applyLibraryFilters(applyCoopFilters(searchData.data, effectiveCoopFilters), libraryFilters)
    : searchData?.data;
  const searchSource = searchData?.meta?.source;
  const allGameIds = useMemo(() => {
    const ids: number[] = [];
    if (filteredRows) for (const row of filteredRows) for (const game of row.games) ids.push(game.id);
    if (searchResults) for (const game of searchResults) ids.push(game.id);
    return ids;
  }, [filteredRows, searchResults]);
  // Pre-filter row count: the empty state has to tell "the library is empty"
  // apart from "the predicates emptied a stocked library" (ROK-1525 B2).
  const hasLibraryRows = (discoverData?.rows?.length ?? 0) > 0;
  return { discoverLoading, searchLoading, isSearching, filteredRows, searchResults, searchSource, allGameIds, coopDataAvailable, effectiveCoopFilters, hasLibraryRows, isLibraryFiltered, clearLibraryFilters };
}

function filterDiscoverRows(rows: GameDiscoverRowDto[] | undefined, activeFilters: typeof GENRE_FILTERS, coopFilters: CoopFilterState, libraryFilters: LibraryFilterState) {
  return rows
    ?.map((row) => ({
      ...row,
      games: applyLibraryFilters(
        applyCoopFilters(
          activeFilters.length > 0
            ? row.games.filter((g) => activeFilters.some(f => f.match(g.genres)))
            : row.games,
          coopFilters,
        ),
        libraryFilters,
      ),
    }))
    .filter((row) => row.games.length > 0);
}

export function GamesPage() {
  const state = useGamesPageState();
  const data = useGamesData(state.searchQuery, state.selectedGenres, state.coopFilters);
  return (
    <div className="pb-24 lg:pb-0">
      <GamesMobileToolbar activeTab={state.activeTab === "manage" ? "manage" : "discover"} onTabChange={(tab) => state.setActiveTab(tab)} showManageTab={state.canManage} />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <LineupBanner />
        <LfgHeartedPrompt />
        <GamesHeader activeTab={state.activeTab} />
        <AdminTabToggle canManage={state.canManage} activeTab={state.activeTab} onTabChange={state.setActiveTab} />
        <ManageTab canManage={state.canManage} activeTab={state.activeTab} showHidden={state.showHidden} setShowHidden={state.setShowHidden} />
        {state.activeTab === "discover" && (
          <DiscoverTab state={state} data={data} />
        )}
      </div>
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
  const { isLfgOnly } = useLfgFilterParam();
  // The lfg view's tiles are mostly off-carousel, so their heart state has to
  // be batched too or they all render as "not hearted".
  const tileGameIds = useTileGameIds(data.allGameIds);
  return (
    <LfgGroupsProvider>
      <WantToPlayProvider gameIds={tileGameIds}>
        <DiscoverFilters state={state} data={data} isLfgOnly={isLfgOnly} />
        {isLfgOnly ? (
          <LfgLookingGrid />
        ) : data.isSearching ? (
          <SearchResults searchLoading={data.searchLoading} searchResults={data.searchResults} searchSource={data.searchSource} searchQuery={state.searchQuery} pricingMap={pricingMap} />
        ) : (
          <DiscoverContent discoverLoading={data.discoverLoading} filteredRows={data.filteredRows} selectedGenres={state.selectedGenres} pricingMap={pricingMap}
            emptyState={{ isLibraryFiltered: data.isLibraryFiltered, hasLibraryRows: data.hasLibraryRows, onClearFilters: data.clearLibraryFilters }} />
        )}
      </WantToPlayProvider>
    </LfgGroupsProvider>
  );
}

/**
 * Search + the one filter entry (ROK-1659). The Filters FAB stays up while
 * searching — only the genre group turns off, since search skips genres.
 */
function DiscoverFilters({ state, data, isLfgOnly }: { state: ReturnType<typeof useGamesPageState>; data: ReturnType<typeof useGamesData>; isLfgOnly: boolean }): JSX.Element {
  const activeCount = useGamesFilterCount(data.effectiveCoopFilters, data.isSearching);
  const resultCount = gamesResultCount({ ...data, isLfgOnly });
  return (
    <>
      <SearchBar searchQuery={state.searchQuery} onSearchChange={state.setSearchQuery} isHeaderHidden={state.isHeaderHidden} resultCount={resultCount}>
        <FilterEntryTrigger activeCount={activeCount} isOpen={state.filtersOpen} onOpenChange={state.setFiltersOpen} />
      </SearchBar>
      <div className={state.filtersOpen ? 'lg:-mt-2 lg:mb-6' : undefined}>
        <GamesFilterPanel activeCount={activeCount} isOpen={state.filtersOpen} onOpenChange={state.setFiltersOpen}
          isSearching={data.isSearching} coopDataAvailable={data.coopDataAvailable}
          coopFilters={state.coopFilters} onCoopFiltersChange={state.setCoopFilters} />
      </div>
    </>
  );
}

function GamesHeader({ activeTab }: { activeTab: GamesTab }): JSX.Element {
  return (
    <div className="hidden lg:block mb-6">
      <h1 className="text-3xl font-bold text-foreground">Game Library</h1>
      <p className="text-muted mt-1">
        {activeTab === "manage" ? "Search, remove, and manage cached games" : "Discover games, see what your community is playing, and find live streams"}
      </p>
    </div>
  );
}

// Stays at `md:` (not `lg:`) on purpose: the phone Discover/Manage switch lives in
// `MobilePageToolbar`, which is `md:hidden`, so this is the only Manage entry at 768–1023px.
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

// Sticky below 1024px (phone + tablet, the FAB layout). Phones sit under the header (64) and the
// Discover/Manage toolbar (~76) — 75 once the header scrolls away. At 768–1023 that toolbar is
// hidden and the header never hides, so the bar sits right under the header (`md:top-16`).
const SEARCH_BAR_CLASS = 'sticky z-10 bg-surface/95 backdrop-blur-sm pt-2 pb-4 -mx-1 px-1 mb-6 transition-[top] duration-300 ease-in-out md:top-16 '
  + 'lg:static lg:z-auto lg:bg-transparent lg:backdrop-blur-none lg:pt-0 lg:pb-0 lg:mx-0 lg:px-0';

function SearchBar({ searchQuery, onSearchChange, isHeaderHidden, resultCount, children }: { searchQuery: string; onSearchChange: (q: string) => void; isHeaderHidden: boolean; resultCount: number | null; children?: ReactNode }): JSX.Element {
  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const hasCount = resultCount !== null;
  return (
    <div className={`${SEARCH_BAR_CLASS} ${isHeaderHidden ? 'top-[75px]' : 'top-[140px]'}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <SearchInput value={searchQuery} onChange={onSearchChange} maxLength={MAX_SEARCH_QUERY_LENGTH}
            placeholder="Search games..." label="Search games" />
        </div>
        {children}
        {hasCount && isDesktop && <span data-testid="games-result-count" className="text-sm text-muted whitespace-nowrap">{formatGamesCount(resultCount)}</span>}
      </div>
      {hasCount && !isDesktop && <p data-testid="games-result-count" className="mt-2 text-xs text-muted">{formatGamesCount(resultCount)}</p>}
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

function SearchResults({ searchLoading, searchResults, searchSource, searchQuery, pricingMap }: {
  searchLoading: boolean; searchResults: GameDetailDto[] | undefined; searchSource: string | undefined; searchQuery: string; pricingMap: PricingMap;
}): JSX.Element {
  if (searchLoading) return <SearchLoadingSkeleton />;
  if (searchResults && searchResults.length > 0) {
    return (
      <>
        {searchSource === 'local' && <LocalSearchWarning />}
        <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {searchResults.map((game) => (<UnifiedGameCard key={game.id} variant="link" game={game} showRating pricing={pricingMap.get(game.id) ?? null} />))}
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
