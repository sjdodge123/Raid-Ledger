import { useState } from "react";
import { useGamesDiscover } from "../hooks/use-games-discover";
import { useGameSearch } from "../hooks/use-game-search";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { useAuth, isOperatorOrAdmin } from "../hooks/use-auth";
import { GameCarousel } from "../components/games/GameCarousel";
import { GameCard } from "../components/games/GameCard";
import { GameLibraryTable } from "../components/admin/GameLibraryTable";
import { GamesMobileToolbar } from "../components/games/games-mobile-toolbar";
import type { GameDetailDto } from "@raid-ledger/contract";

/** Common IGDB genre IDs for filter pills */
const GENRE_FILTERS = [
  { id: 12, label: "RPG" },
  { id: 5, label: "Shooter" },
  { id: 31, label: "Adventure" },
  { id: 15, label: "Strategy" },
  { id: 13, label: "Simulator" },
  { id: 14, label: "Sport" },
  { id: 10, label: "Racing" },
  { id: 4, label: "Fighting" },
  { id: 32, label: "Indie" },
  { id: 36, label: "MOBA" },
];

type GamesTab = "discover" | "manage";

export function GamesPage() {
  const { user } = useAuth();
  const canManage = isOperatorOrAdmin(user);
  const [activeTab, setActiveTab] = useState<GamesTab>("discover");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  const { data: discoverData, isLoading: discoverLoading } = useGamesDiscover();
  const { data: searchData, isLoading: searchLoading } = useGameSearch(
    debouncedSearch,
    debouncedSearch.length >= 2,
  );

  const isSearching = debouncedSearch.length >= 2;

  // Filter discover results by genre if selected
  const filteredRows = discoverData?.rows
    ?.map((row) => ({
      ...row,
      games: selectedGenre
        ? row.games.filter((g) => g.genres.includes(selectedGenre))
        : row.games,
    }))
    .filter((row) => row.games.length > 0);

  // Map search results to GameDetailDto format for the grid
  const searchResults: GameDetailDto[] | undefined = searchData?.data?.map(
    (g) => ({
      ...g,
      genres: [],
      summary: null,
      rating: null,
      aggregatedRating: null,
      popularity: null,
      gameModes: [],
      themes: [],
      platforms: [],
      screenshots: [],
      videos: [],
      firstReleaseDate: null,
      playerCount: null,
      twitchGameId: null,
      crossplay: null,
    }),
  );

  return (
    <div>
      <GamesMobileToolbar
        activeTab={activeTab === "manage" ? "library" : "discover"}
        onTabChange={(tab) => setActiveTab(tab === "library" ? "manage" : "discover")}
        showLibraryTab={canManage}
      />

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Game Library</h1>
          <p className="text-muted mt-1">
            {activeTab === "manage"
              ? "Search, remove, and manage cached games"
              : "Discover games, see what your community is playing, and find live streams"}
          </p>
        </div>

        {/* Admin tab toggle */}
        {canManage && (
          <div className="flex rounded-lg bg-panel/50 border border-edge p-1 w-fit mb-6">
            <button
              type="button"
              onClick={() => setActiveTab("discover")}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${activeTab === "discover"
                ? "bg-overlay text-foreground"
                : "text-muted hover:text-secondary"
                }`}
            >
              Discover
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("manage")}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${activeTab === "manage"
                ? "bg-overlay text-foreground"
                : "text-muted hover:text-secondary"
                }`}
            >
              Manage
            </button>
          </div>
        )}

        {/* Manage tab (admin only) */}
        {activeTab === "manage" && canManage && <GameLibraryTable />}

        {/* Discover tab */}
        {activeTab === "discover" && (
          <>
            {/* Search Bar */}
            <div className="relative mb-6">
              <svg
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dim"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search games..."
                className="w-full pl-12 pr-4 py-3 bg-surface/50 border border-edge rounded-xl text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-dim hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>

            {/* Genre Filter Pills */}
            {!isSearching && (
              <div
                className="flex gap-2 mb-8 overflow-x-auto pb-2"
                style={{ scrollbarWidth: "none" }}
              >
                <button
                  onClick={() => setSelectedGenre(null)}
                  className={`px-3 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedGenre === null
                    ? "bg-emerald-600 text-white"
                    : "bg-panel text-secondary hover:bg-overlay"
                    }`}
                >
                  All
                </button>
                {GENRE_FILTERS.map((genre) => (
                  <button
                    key={genre.id}
                    onClick={() =>
                      setSelectedGenre(
                        selectedGenre === genre.id ? null : genre.id,
                      )
                    }
                    className={`px-3 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedGenre === genre.id
                      ? "bg-emerald-600 text-white"
                      : "bg-panel text-secondary hover:bg-overlay"
                      }`}
                  >
                    {genre.label}
                  </button>
                ))}
              </div>
            )}

            {/* Content */}
            {isSearching ? (
              // Search results grid
              <div>
                {searchLoading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="animate-pulse">
                        <div className="aspect-[3/4] bg-overlay rounded-xl" />
                        <div className="mt-2 h-4 bg-overlay rounded w-3/4" />
                      </div>
                    ))}
                  </div>
                ) : searchResults && searchResults.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {searchResults.map((game) => (
                      <GameCard key={game.id} game={game} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <p className="text-muted text-lg">
                      No games found for &ldquo;{debouncedSearch}&rdquo;
                    </p>
                    <p className="text-dim text-sm mt-1">
                      Try a different search term
                    </p>
                  </div>
                )}
              </div>
            ) : (
              // Discovery carousels
              <div className="space-y-8">
                {discoverLoading ? (
                  // Loading skeletons
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-6 bg-overlay rounded w-48 mb-3" />
                      <div className="flex gap-4">
                        {Array.from({ length: 6 }).map((_, j) => (
                          <div key={j} className="w-[180px] flex-shrink-0">
                            <div className="aspect-[3/4] bg-overlay rounded-xl" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : filteredRows && filteredRows.length > 0 ? (
                  filteredRows.map((row) => (
                    <GameCarousel
                      key={row.slug}
                      category={row.category}
                      games={row.games}
                    />
                  ))
                ) : (
                  <div className="text-center py-16">
                    <p className="text-muted text-lg">
                      No games in the library yet
                    </p>
                    <p className="text-dim text-sm mt-1">
                      {selectedGenre
                        ? "Try selecting a different genre"
                        : "Games will appear here once synced from IGDB"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
