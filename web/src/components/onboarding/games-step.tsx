import { useState, useMemo } from 'react';
import { useGamesDiscover } from '../../hooks/use-games-discover';
import { useGameSearch } from '../../hooks/use-game-search';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useAuth } from '../../hooks/use-auth';
import { WantToPlayProvider } from '../../hooks/use-want-to-play-batch';
import type { GameDetailDto } from '@raid-ledger/contract';
import { UnifiedGameCard } from '../games/unified-game-card';

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

/**
 * Wrapper that bridges useWantToPlay with UnifiedGameCard toggle variant.
 * Clicking anywhere on the card toggles the heart (ROK-312).
 */
function OnboardingCardWrapper({ game }: { game: GameDetailDto }) {
    const { isAuthenticated } = useAuth();
    const { wantToPlay, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? game.id : undefined,
    );
    const handleToggle = (): void => {
        if (!isToggling && isAuthenticated) toggle(!wantToPlay);
    };
    return (
        <UnifiedGameCard
            variant="toggle"
            game={game}
            selected={wantToPlay}
            onToggle={handleToggle}
        />
    );
}

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
function flattenDiscoverGames(
    rows: Array<{ games: GameDetailDto[] }> | undefined,
): GameDetailDto[] {
    if (!rows) return [];
    const seen = new Set<number>();
    const games: GameDetailDto[] = [];
    for (const row of rows) {
        for (const game of row.games) {
            if (!seen.has(game.id)) {
                seen.add(game.id);
                games.push(game);
            }
        }
    }
    return games;
}

function GameSearchInput({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="relative max-w-md mx-auto">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Search for a game..."
                className="w-full pl-10 pr-4 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
        </div>
    );
}

function GenreChips({
    selectedGenre,
    onSelect,
}: {
    selectedGenre: number | null;
    onSelect: (id: number | null) => void;
}) {
    const chipCls = (active: boolean) =>
        `px-3 py-2.5 min-h-[44px] rounded-full text-xs font-medium transition-colors ${active ? 'bg-emerald-600 text-white' : 'bg-panel text-muted hover:bg-overlay'}`;
    return (
        <div className="flex flex-wrap gap-2 justify-center">
            <button onClick={() => onSelect(null)} className={chipCls(selectedGenre === null)}>All</button>
            {GENRE_CHIPS.map((g) => (
                <button key={g.id} onClick={() => onSelect(selectedGenre === g.id ? null : g.id)} className={chipCls(selectedGenre === g.id)}>
                    {g.label}
                </button>
            ))}
        </div>
    );
}

function LocalSearchBanner() {
    return (
        <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-yellow-900/30 border border-yellow-700/40 text-yellow-500 text-xs font-medium">
            <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
            </svg>
            Showing local results (external search unavailable)
        </div>
    );
}

function GamesStepHeader() {
    return (
        <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground">
                What Do You Play?
            </h2>
            <p className="text-muted mt-2">
                Heart the games you're interested in. This helps us find you
                raid groups.
            </p>
        </div>
    );
}

export function GamesStep() {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
    const [snapshot, setSnapshot] = useState<GameDetailDto[] | null>(null);
    const { data: discoverData, isLoading: discoverLoading } = useGamesDiscover();
    const { data: searchData, isLoading: searchLoading } = useGameSearch(searchQuery, searchQuery.length >= 2);
    const isSearching = searchQuery.length >= 2;
    const allGames = useMemo(() => snapshot ?? flattenDiscoverGames(discoverData?.rows), [discoverData, snapshot]);
    if (allGames.length > 0 && !snapshot) setSnapshot(allGames);
    const filteredGames = useMemo(
        () => selectedGenre ? allGames.filter((g) => g.genres.includes(selectedGenre)) : allGames,
        [allGames, selectedGenre],
    );
    const displayGames = isSearching ? (searchData?.data ?? []) : filteredGames;
    const displayGameIds = useMemo(() => displayGames.slice(0, 24).map((g) => g.id), [displayGames]);
    return (
        <div className="space-y-5">
            <GamesStepHeader />
            <GameSearchInput value={searchQuery} onChange={setSearchQuery} />
            {!isSearching && <GenreChips selectedGenre={selectedGenre} onSelect={setSelectedGenre} />}
            <GamesStepGrid
                discoverLoading={discoverLoading} searchLoading={searchLoading} isSearching={isSearching}
                displayGames={displayGames} displayGameIds={displayGameIds} searchSource={searchData?.meta?.source}
            />
        </div>
    );
}

function GamesStepLoading() {
    return (
        <div className="text-center py-8">
            <div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-dim text-sm">Loading games...</p>
        </div>
    );
}

function GamesStepGrid({
    discoverLoading,
    searchLoading,
    isSearching,
    displayGames,
    displayGameIds,
    searchSource,
}: {
    discoverLoading: boolean;
    searchLoading: boolean;
    isSearching: boolean;
    displayGames: GameDetailDto[];
    displayGameIds: number[];
    searchSource?: string;
}) {
    if ((discoverLoading || searchLoading) && displayGames.length === 0) return <GamesStepLoading />;
    if (displayGames.length === 0) return (
        <div className="text-center py-8"><p className="text-dim text-sm">{isSearching ? 'No games found. Try a different search.' : 'No games available.'}</p></div>
    );
    return (
        <WantToPlayProvider gameIds={displayGameIds}>
            {isSearching && searchSource === 'local' && <LocalSearchBanner />}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {displayGames.slice(0, 24).map((game) => <OnboardingCardWrapper key={game.id} game={game} />)}
            </div>
        </WantToPlayProvider>
    );
}
