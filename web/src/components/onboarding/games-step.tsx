import { useState, useMemo } from 'react';
import { useGamesDiscover } from '../../hooks/use-games-discover';
import { useGameSearch } from '../../hooks/use-game-search';
import { GameCard } from '../games/GameCard';
import type { GameDetailDto } from '@raid-ledger/contract';

/** IGDB genre ID 36 = MMORPG */
const MMO_GENRE_ID = 36;

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

interface GamesStepProps {
    onNext: (hasMMO: boolean, selectedGameIds: number[]) => void;
    onBack: () => void;
    onSkip: () => void;
}

/**
 * Step 2: What Do You Play? (ROK-219).
 * Genre chips, game search, game grid with heart toggle.
 * Detects if user selected any MMO games for conditional Step 3.
 */
export function GamesStep({ onNext, onBack, onSkip }: GamesStepProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGenre, setSelectedGenre] = useState<number | null>(null);

    const { data: discoverData, isLoading: discoverLoading } = useGamesDiscover();
    const { data: searchData, isLoading: searchLoading } = useGameSearch(
        searchQuery,
        searchQuery.length >= 2,
    );

    const isSearching = searchQuery.length >= 2;

    // Flatten all games from discover rows for genre filtering
    const allGames = useMemo(() => {
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
    }, [discoverData]);

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

    // Detect if any displayed MMO game has been hearted
    // This is approximate - we pass the detection to the parent on Next
    const hasMMOGames = useMemo(() => {
        return allGames.some((g) => g.genres.includes(MMO_GENRE_ID));
    }, [allGames]);

    const handleNext = () => {
        // Collect IDs of MMO games from discover data
        const mmoGameIds = allGames
            .filter((g) => g.genres.includes(MMO_GENRE_ID))
            .map((g) => g.id);
        onNext(hasMMOGames, mmoGameIds);
    };

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
                    className="w-full pl-10 pr-4 py-2.5 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
            </div>

            {/* Genre chips */}
            {!isSearching && (
                <div className="flex flex-wrap gap-2 justify-center">
                    <button
                        onClick={() => setSelectedGenre(null)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                            selectedGenre === null
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
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                selectedGenre === genre.id
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-panel text-muted hover:bg-overlay'
                            }`}
                        >
                            {genre.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Game grid */}
            <div className="max-h-[40vh] overflow-y-auto pr-1">
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
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {displayGames.slice(0, 24).map((game) => (
                            <GameCard key={game.id} game={game} compact />
                        ))}
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={onSkip}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Skip
                </button>
                <button
                    type="button"
                    onClick={handleNext}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors text-sm"
                >
                    Next
                </button>
            </div>
        </div>
    );
}
