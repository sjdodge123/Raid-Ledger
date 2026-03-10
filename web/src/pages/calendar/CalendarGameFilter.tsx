import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Modal } from '../../components/ui/modal';
import { getGameColors } from '../../constants/game-colors';
import type { GameWithLiked } from './game-filter-helpers';

interface GameInfo {
    slug: string;
    name: string;
    coverUrl: string | null;
}

interface CalendarGameFilterSheetProps {
    isOpen: boolean;
    onClose: () => void;
    allKnownGames: GameInfo[];
    selectedGames: Set<string>;
    toggleGame: (slug: string) => void;
    selectAllGames: () => void;
    deselectAllGames: () => void;
    likedSlugs?: Set<string>;
}

/** Mobile bottom sheet for game filtering */
export function CalendarGameFilterSheet({
    isOpen, onClose, allKnownGames, selectedGames,
    toggleGame, selectAllGames, deselectAllGames, likedSlugs,
}: CalendarGameFilterSheetProps): JSX.Element {
    const sortedGames = useSortedGames(allKnownGames, likedSlugs);

    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} title="Filter by Game">
            <FilterActions count={selectedGames.size} total={allKnownGames.length}
                onSelectAll={selectAllGames} onDeselectAll={deselectAllGames} />
            <div className="space-y-1">
                <SectionedGameList games={sortedGames} selectedGames={selectedGames}
                    toggleGame={toggleGame} renderItem={MobileGameFilterItem} />
            </div>
        </BottomSheet>
    );
}

interface CalendarGameFilterModalProps {
    isOpen: boolean;
    onClose: () => void;
    allKnownGames: GameInfo[];
    selectedGames: Set<string>;
    toggleGame: (slug: string) => void;
    selectAllGames: () => void;
    deselectAllGames: () => void;
    likedSlugs?: Set<string>;
}

/** Desktop overflow modal for game filters */
export function CalendarGameFilterModal({
    isOpen, onClose, allKnownGames, selectedGames,
    toggleGame, selectAllGames, deselectAllGames, likedSlugs,
}: CalendarGameFilterModalProps): JSX.Element {
    const [filterSearch, setFilterSearch] = useState('');
    const sortedGames = useSortedGames(allKnownGames, likedSlugs);

    const filteredGames = useMemo(() => {
        if (!filterSearch.trim()) return sortedGames;
        const q = filterSearch.toLowerCase();
        return sortedGames.filter((g) => g.name.toLowerCase().includes(q));
    }, [sortedGames, filterSearch]);

    return (
        <Modal isOpen={isOpen} onClose={() => { onClose(); setFilterSearch(''); }} title="Filter by Game" maxWidth="max-w-sm">
            <FilterActions count={selectedGames.size} total={allKnownGames.length}
                onSelectAll={selectAllGames} onDeselectAll={deselectAllGames} />
            <input type="text" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Search games..."
                className="w-full px-3 py-2 mb-3 rounded-lg bg-base border border-edge text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-emerald-500 transition-colors"
                ref={(el) => el?.focus()} />
            <div className="game-filter-list" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                <SectionedGameList games={filteredGames} selectedGames={selectedGames}
                    toggleGame={toggleGame} renderItem={ModalGameItem} />
            </div>
        </Modal>
    );
}

/** Hook to sort games with liked first, annotating each with liked flag. */
function useSortedGames(games: GameInfo[], likedSlugs?: Set<string>): GameWithLiked[] {
    return useMemo(() => {
        const slugs = likedSlugs ?? new Set<string>();
        return games
            .map((g) => ({ ...g, liked: slugs.has(g.slug) }))
            .sort((a, b) => {
                if (a.liked !== b.liked) return a.liked ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    }, [games, likedSlugs]);
}

/** Shared filter action buttons (All / None + count). */
function FilterActions({ count, total, onSelectAll, onDeselectAll }: {
    count: number; total: number; onSelectAll: () => void; onDeselectAll: () => void;
}): JSX.Element {
    return (
        <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted">{count} of {total} selected</span>
            <div className="flex gap-2">
                <button type="button" onClick={onSelectAll} className="filter-action-btn">All</button>
                <button type="button" onClick={onDeselectAll} className="filter-action-btn">None</button>
            </div>
        </div>
    );
}

type GameItemRenderer = (props: {
    game: GameWithLiked; isSelected: boolean; onToggle: () => void;
}) => JSX.Element;

/** Game list with visual section headers for liked vs other games. */
export function SectionedGameList({ games, selectedGames, toggleGame, renderItem }: {
    games: GameWithLiked[];
    selectedGames: Set<string>;
    toggleGame: (slug: string) => void;
    renderItem?: GameItemRenderer;
}): JSX.Element {
    const liked = games.filter((g) => g.liked);
    const other = games.filter((g) => !g.liked);
    const hasLiked = liked.length > 0;
    const hasOther = other.length > 0;
    const showSections = hasLiked;
    const ItemComponent = renderItem ?? ModalGameItem;

    return (
        <>
            {showSections && <SectionHeader label="Your Games" />}
            {liked.map((game) => (
                <ItemComponent key={game.slug} game={game}
                    isSelected={selectedGames.has(game.slug)} onToggle={() => toggleGame(game.slug)} />
            ))}
            {showSections && hasOther && <SectionDivider label="Other Games" />}
            {other.map((game) => (
                <ItemComponent key={game.slug} game={game}
                    isSelected={selectedGames.has(game.slug)} onToggle={() => toggleGame(game.slug)} />
            ))}
        </>
    );
}

/** Section header for game groups. */
function SectionHeader({ label }: { label: string }): JSX.Element {
    return (
        <div className="text-xs font-semibold text-muted uppercase tracking-wider px-1 pt-1 pb-2">
            {label}
        </div>
    );
}

/** Divider with label between game sections. */
function SectionDivider({ label }: { label: string }): JSX.Element {
    return (
        <div className="flex items-center gap-2 px-1 pt-3 pb-2">
            <div className="flex-1 border-t border-edge" />
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">{label}</span>
            <div className="flex-1 border-t border-edge" />
        </div>
    );
}

/** Single game item in the mobile filter sheet */
function MobileGameFilterItem({ game, isSelected, onToggle }: {
    game: GameWithLiked; isSelected: boolean; onToggle: () => void;
}): JSX.Element {
    const colors = getGameColors(game.slug);
    return (
        <button onClick={onToggle}
            className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors ${
                isSelected ? 'bg-emerald-500/10 text-foreground' : 'text-muted hover:bg-panel'
            }`}>
            <GameIcon coverUrl={game.coverUrl} name={game.name} icon={colors.icon} />
            <span className="flex-1 text-left text-sm font-medium">{game.name}</span>
            <CheckMark isSelected={isSelected} />
        </button>
    );
}

/** Game icon with cover image or emoji fallback. */
function GameIcon({ coverUrl, name, icon }: {
    coverUrl: string | null; name: string; icon: string;
}): JSX.Element {
    return (
        <div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center bg-panel">
            {coverUrl
                ? <img src={coverUrl} alt={name} className="w-full h-full object-cover" />
                : <span className="text-sm">{icon}</span>}
        </div>
    );
}

/** Checkbox check mark indicator. */
function CheckMark({ isSelected }: { isSelected: boolean }): JSX.Element {
    return (
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-edge'
        }`}>
            {isSelected && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
            )}
        </div>
    );
}

/** Modal game item with checkbox style. */
function ModalGameItem({ game, isSelected, onToggle }: {
    game: GameWithLiked; isSelected: boolean; onToggle: () => void;
}): JSX.Element {
    const colors = getGameColors(game.slug);
    return (
        <label className={`game-filter-item ${isSelected ? 'selected' : ''}`}
            style={{ '--game-color': colors.bg, '--game-border': colors.border } as React.CSSProperties}>
            <input type="checkbox" checked={isSelected} onChange={onToggle} className="game-filter-checkbox" />
            <div className="game-filter-icon">
                {game.coverUrl
                    ? <img src={game.coverUrl} alt={game.name} className="game-filter-cover" />
                    : <span className="game-filter-emoji">{colors.icon}</span>}
            </div>
            <span className="game-filter-name">{game.name}</span>
        </label>
    );
}
