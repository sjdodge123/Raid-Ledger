import { useState, useMemo } from 'react';
import { useGamesDiscover } from '../../hooks/use-games-discover';
import { useGameSearch } from '../../hooks/use-game-search';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useAuth } from '../../hooks/use-auth';
import { WantToPlayProvider } from '../../hooks/use-want-to-play-batch';
import type { GameDetailDto } from '@raid-ledger/contract';
import { GENRE_MAP } from '../../lib/game-utils';

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

const HEART_PATH = 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z';

function OnboardingCardCover({ game, primaryGenre, wantToPlay, count }: {
    game: GameDetailDto; primaryGenre: string | null; wantToPlay: boolean; count: number;
}) {
    return (
        <div className="relative aspect-[3/4] bg-overlay">
            {game.coverUrl ? <img src={game.coverUrl} alt={game.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" /> : (
                <div className="w-full h-full flex items-center justify-center text-dim"><svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-3">
                <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">{game.name}</h3>
                {primaryGenre && <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] bg-white/20 text-white/90 rounded">{primaryGenre}</span>}
            </div>
            <div className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50">
                <svg className={`w-5 h-5 transition-colors ${wantToPlay ? 'text-red-400 fill-red-400' : 'text-white/70'}`} fill={wantToPlay ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={HEART_PATH} />
                </svg>
                {count > 0 && <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-bold text-white/90 bg-black/70 rounded-full px-1.5 py-0.5">{count}</span>}
            </div>
        </div>
    );
}

function OnboardingGameCard({ game }: OnboardingGameCardProps) {
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, toggle, isToggling } = useWantToPlay(isAuthenticated ? game.id : undefined);
    const primaryGenre = game.genres[0] ? GENRE_MAP[game.genres[0]] : null;

    const handleClick = () => { if (!isToggling && isAuthenticated) toggle(!wantToPlay); };

    return (
        <div role="button" tabIndex={0} onClick={handleClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
            className={`group relative rounded-xl overflow-hidden bg-panel border-2 transition-all cursor-pointer hover:shadow-lg hover:shadow-emerald-900/20 ${wantToPlay ? 'border-emerald-500 shadow-emerald-500/20 shadow-md' : 'border-edge/50 hover:border-emerald-500/50'}`}>
            <OnboardingCardCover game={game} primaryGenre={primaryGenre} wantToPlay={wantToPlay} count={count} />
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
function flattenDiscoverGames(rows: Array<{ games: GameDetailDto[] }> | undefined): GameDetailDto[] {
    if (!rows) return [];
    const seen = new Set<number>();
    const games: GameDetailDto[] = [];
    for (const row of rows) {
        for (const game of row.games) {
            if (!seen.has(game.id)) { seen.add(game.id); games.push(game); }
        }
    }
    return games;
}

function GameSearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="relative max-w-md mx-auto">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search for a game..."
                className="w-full pl-10 pr-4 py-2.5 min-h-[44px] bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
        </div>
    );
}

function GenreChips({ selectedGenre, onSelect }: { selectedGenre: number | null; onSelect: (id: number | null) => void }) {
    const chipCls = (active: boolean) => `px-3 py-2.5 min-h-[44px] rounded-full text-xs font-medium transition-colors ${active ? 'bg-emerald-600 text-white' : 'bg-panel text-muted hover:bg-overlay'}`;
    return (
        <div className="flex flex-wrap gap-2 justify-center">
            <button onClick={() => onSelect(null)} className={chipCls(selectedGenre === null)}>All</button>
            {GENRE_CHIPS.map((g) => <button key={g.id} onClick={() => onSelect(selectedGenre === g.id ? null : g.id)} className={chipCls(selectedGenre === g.id)}>{g.label}</button>)}
        </div>
    );
}

function LocalSearchBanner() {
    return (
        <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-yellow-900/30 border border-yellow-700/40 text-yellow-500 text-xs font-medium">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Showing local results (external search unavailable)
        </div>
    );
}

function GamesStepHeader() {
    return (
        <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground">What Do You Play?</h2>
            <p className="text-muted mt-2">Heart the games you're interested in. This helps us find you raid groups.</p>
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
    const filteredGames = useMemo(() => selectedGenre ? allGames.filter((g) => g.genres.includes(selectedGenre)) : allGames, [allGames, selectedGenre]);
    const displayGames = isSearching ? (searchData?.data ?? []) : filteredGames;
    const displayGameIds = useMemo(() => displayGames.slice(0, 24).map((g) => g.id), [displayGames]);

    return (
        <div className="space-y-5">
            <GamesStepHeader />
            <GameSearchInput value={searchQuery} onChange={setSearchQuery} />
            {!isSearching && <GenreChips selectedGenre={selectedGenre} onSelect={setSelectedGenre} />}
            <GamesStepGrid discoverLoading={discoverLoading} searchLoading={searchLoading} isSearching={isSearching}
                displayGames={displayGames} displayGameIds={displayGameIds} searchSource={searchData?.meta?.source} />
        </div>
    );
}

function GamesStepGrid({ discoverLoading, searchLoading, isSearching, displayGames, displayGameIds, searchSource }: {
    discoverLoading: boolean; searchLoading: boolean; isSearching: boolean;
    displayGames: GameDetailDto[]; displayGameIds: number[]; searchSource?: string;
}) {
    if ((discoverLoading || searchLoading) && displayGames.length === 0) {
        return <div className="text-center py-8"><div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /><p className="text-dim text-sm">Loading games...</p></div>;
    }
    if (displayGames.length === 0) {
        return <div className="text-center py-8"><p className="text-dim text-sm">{isSearching ? 'No games found. Try a different search.' : 'No games available.'}</p></div>;
    }
    return (
        <WantToPlayProvider gameIds={displayGameIds}>
            {isSearching && searchSource === 'local' && <LocalSearchBanner />}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{displayGames.slice(0, 24).map((game) => <OnboardingGameCard key={game.id} game={game} />)}</div>
        </WantToPlayProvider>
    );
}
