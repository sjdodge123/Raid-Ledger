import { useState, useMemo } from 'react';
import { useGamesDiscover } from '../../hooks/use-games-discover';
import { useGameSearch } from '../../hooks/use-game-search';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useAuth } from '../../hooks/use-auth';
import type { GameDetailDto } from '@raid-ledger/contract';



/** IGDB genre ID → display name (subset for onboarding) */
const GENRE_MAP: Record<number, string> = {
    5: 'Shooter',
    12: 'RPG',
    13: 'Simulator',
    15: 'Strategy',
    31: 'Adventure',
    32: 'Indie',
    36: 'MMORPG',
};

/** Genre filter chips for narrowing discover results */
const GENRE_CHIPS = [
    { id: 12, label: 'RPG' },
    { id: 5, label: 'Shooter' },
    { id: 31, label: 'Adventure' },
    { id: 15, label: 'Strategy' },
    { id: 36, label: 'MMORPG' },
    { id: 32, label: 'Indie' },
    { id: 13, label: 'Simulator' },
];



// ── Inline OnboardingGameCard ──────────────────────────────────────────
// Renders a <div> (not <Link>) so clicking anywhere toggles the heart.
// No rating badge, no info bar — simplified for onboarding.

interface OnboardingGameCardProps {
    game: GameDetailDto;
}

function OnboardingGameCard({ game }: OnboardingGameCardProps) {
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? game.id : undefined,
    );

    const primaryGenre = game.genres[0] ? GENRE_MAP[game.genres[0]] : null;

    const handleClick = () => {
        if (!isToggling && isAuthenticated) {
            toggle(!wantToPlay);
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick();
                }
            }}
            className={`group relative rounded-xl overflow-hidden bg-panel border-2 transition-all cursor-pointer hover:shadow-lg hover:shadow-emerald-900/20 ${wantToPlay
                ? 'border-emerald-500 shadow-emerald-500/20 shadow-md'
                : 'border-edge/50 hover:border-emerald-500/50'
                }`}
        >
            {/* Cover Image */}
            <div className="relative aspect-[3/4] bg-overlay">
                {game.coverUrl ? (
                    <img
                        src={game.coverUrl}
                        alt={game.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-dim">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}

                {/* Bottom gradient overlay */}
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />

                {/* Game name + genre tag */}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
                        {game.name}
                    </h3>
                    {primaryGenre && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] bg-white/20 text-white/90 rounded">
                            {primaryGenre}
                        </span>
                    )}
                </div>

                {/* Heart icon + count */}
                <div className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50">
                    <svg
                        className={`w-5 h-5 transition-colors ${wantToPlay ? 'text-red-400 fill-red-400' : 'text-white/70'
                            }`}
                        fill={wantToPlay ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    {count > 0 && (
                        <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-bold text-white/90 bg-black/70 rounded-full px-1.5 py-0.5">{count}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── GamesStep ──────────────────────────────────────────────────────────

/**
 * Step 2: What Do You Play? (ROK-219 / ROK-312).
 * Genre chips, game search, game grid with heart toggle.
 * Detects if user selected any MMO games for conditional Step 3.
 *
 * ROK-312 fixes:
 * - Removed nested scroll container (wizard handles scroll)
 * - OnboardingGameCard replaces GameCard (no navigation on click)
 * - useState snapshot freezes game order on heart toggle
 * - Grid changed to grid-cols-2 sm:grid-cols-3 (responsive fill)
 */
export function GamesStep() {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGenre, setSelectedGenre] = useState<number | null>(null);

    // Snapshot: freeze the game order so heart toggles don't reshuffle
    const [snapshot, setSnapshot] = useState<GameDetailDto[] | null>(null);

    const { data: discoverData, isLoading: discoverLoading } = useGamesDiscover();
    const { data: searchData, isLoading: searchLoading } = useGameSearch(
        searchQuery,
        searchQuery.length >= 2,
    );

    const isSearching = searchQuery.length >= 2;

    // Flatten all games from discover rows (frozen after first load)
    const allGames = useMemo(() => {
        if (snapshot) return snapshot;
        if (!discoverData?.rows) return [];
        const seen = new Set<number>();
        const games: GameDetailDto[] = [];
        for (const row of discoverData.rows) {
            for (const game of row.games) {
                if (!seen.has(game.id)) {
                    seen.add(game.id);
                    games.push(game);
                }
            }
        }
        return games;
    }, [discoverData, snapshot]);

    // Freeze order on first successful load (React "adjust state during render" pattern)
    if (allGames.length > 0 && !snapshot) {
        setSnapshot(allGames);
    }

    // Filter by selected genre
    const filteredGames = useMemo(() => {
        if (!selectedGenre) return allGames;
        return allGames.filter((g) => g.genres.includes(selectedGenre));
    }, [allGames, selectedGenre]);

    // Map search results to GameDetailDto format
    const searchResults: GameDetailDto[] | undefined = useMemo(
        () =>
            searchData?.data?.map((g) => ({
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
            })),
        [searchData],
    );

    const displayGames = isSearching ? (searchResults ?? []) : filteredGames;



    return (
        <div className="space-y-5">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-foreground">What Do You Play?</h2>
                <p className="text-muted mt-2">Heart the games you're interested in. This helps us find you raid groups.</p>
            </div>

            {/* Search */}
            <div className="relative max-w-md mx-auto">
                <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dim"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for a game..."
                    className="w-full pl-10 pr-4 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
            </div>

            {/* Genre chips */}
            {!isSearching && (
                <div className="flex flex-wrap gap-2 justify-center">
                    <button
                        onClick={() => setSelectedGenre(null)}
                        className={`px-3 py-2.5 min-h-[44px] rounded-full text-xs font-medium transition-colors ${selectedGenre === null
                            ? 'bg-emerald-600 text-white'
                            : 'bg-panel text-muted hover:bg-overlay'
                            }`}
                    >
                        All
                    </button>
                    {GENRE_CHIPS.map((genre) => (
                        <button
                            key={genre.id}
                            onClick={() =>
                                setSelectedGenre(selectedGenre === genre.id ? null : genre.id)
                            }
                            className={`px-3 py-2.5 min-h-[44px] rounded-full text-xs font-medium transition-colors ${selectedGenre === genre.id
                                ? 'bg-emerald-600 text-white'
                                : 'bg-panel text-muted hover:bg-overlay'
                                }`}
                        >
                            {genre.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Game grid — no nested scroll, wizard handles overflow */}
            {(discoverLoading || searchLoading) && displayGames.length === 0 ? (
                <div className="text-center py-8">
                    <div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-dim text-sm">Loading games...</p>
                </div>
            ) : displayGames.length === 0 ? (
                <div className="text-center py-8">
                    <p className="text-dim text-sm">
                        {isSearching ? 'No games found. Try a different search.' : 'No games available.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {displayGames.slice(0, 24).map((game) => (
                        <OnboardingGameCard key={game.id} game={game} />
                    ))}
                </div>
            )}

        </div>
    );
}
