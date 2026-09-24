/**
 * ROK-1662 — the calendar's game filter controls, rendered inside the shared
 * `FilterEntry` (toolbar funnel + inline panel at 1024px and up, Filters FAB +
 * BottomSheet below). "Clear all" (= show every game) lives in the panel /
 * sheet header; this body adds the game search, "N of M selected" + "None",
 * and the sectioned game list, which scrolls inside the panel / sheet.
 */
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { getGameColors } from '../../constants/game-colors';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { SearchInput } from '../../components/ui/search-input';
import type { GameInfo } from '../../stores/game-filter-store';
import {
    countHiddenGames, filterGamesByName, sortGamesWithLikedFirst, type GameWithLiked,
} from './game-filter-helpers';

export interface CalendarGameFilterControlsProps {
    allKnownGames: GameInfo[];
    selectedGames: Set<string>;
    toggleGame: (slug: string) => void;
    deselectAllGames: () => void;
    likedSlugs?: Set<string>;
    /** `panel`: desktop inline FilterPanel (4-column checkbox grid). `sheet`: phone/tablet BottomSheet (tap rows). */
    layout: 'panel' | 'sheet';
}

/** Search + selection summary + sectioned game list. */
export function CalendarGameFilterControls({
    allKnownGames, selectedGames, toggleGame, deselectAllGames, likedSlugs, layout,
}: CalendarGameFilterControlsProps): JSX.Element {
    const [search, setSearch] = useState('');
    const sortedGames = useMemo(
        () => sortGamesWithLikedFirst(allKnownGames, likedSlugs ?? new Set<string>()),
        [allKnownGames, likedSlugs],
    );
    const visibleGames = useMemo(() => filterGamesByName(sortedGames, search), [sortedGames, search]);
    const selectedCount = allKnownGames.length - countHiddenGames(allKnownGames, selectedGames);
    const isPanel = layout === 'panel';
    return (
        <div className="space-y-3">
            <div className={isPanel ? 'flex flex-wrap items-center gap-3' : 'space-y-3'}>
                <div className={isPanel ? 'w-64 max-w-full' : undefined}>
                    <SearchInput value={search} onChange={setSearch} placeholder="Search games..." label="Search games" />
                </div>
                <SelectionSummary count={selectedCount} total={allKnownGames.length} onNone={deselectAllGames}
                    className={isPanel ? 'ml-auto' : undefined} />
            </div>
            <div data-testid="calendar-game-list"
                className={isPanel ? 'grid grid-cols-4 gap-x-4 max-h-80 overflow-y-auto' : 'space-y-1'}>
                {visibleGames.length === 0 && <p className="col-span-full px-1 py-2 text-sm text-muted">No games match your search.</p>}
                <SectionedGameList games={visibleGames} selectedGames={selectedGames} toggleGame={toggleGame}
                    renderItem={isPanel ? CheckboxGameItem : SheetGameItem} />
            </div>
        </div>
    );
}

/** "N of M selected" + "None" (hide every game). */
function SelectionSummary({ count, total, onNone, className }: {
    count: number; total: number; onNone: () => void; className?: string;
}): JSX.Element {
    return (
        <div className={`flex items-center justify-between gap-3 ${className ?? ''}`}>
            <span className="text-sm text-muted">{count} of {total} selected</span>
            <Button variant="secondary" size="sm" onClick={onNone}>None</Button>
        </div>
    );
}

/** Game list with visual section headers for liked vs other games. */
export function SectionedGameList({ games, selectedGames, toggleGame, renderItem }: {
    games: GameWithLiked[];
    selectedGames: Set<string>;
    toggleGame: (slug: string) => void;
    renderItem?: GameItemRenderer;
}): JSX.Element {
    const liked = games.filter((g) => g.liked);
    const other = games.filter((g) => !g.liked);
    const showSections = liked.length > 0;
    const ItemComponent = renderItem ?? CheckboxGameItem;

    return (
        <>
            {showSections && <SectionHeader label="Your Games" />}
            {liked.map((game) => (
                <ItemComponent key={game.slug} game={game}
                    isSelected={selectedGames.has(game.slug)} onToggle={() => toggleGame(game.slug)} />
            ))}
            {showSections && other.length > 0 && <SectionDivider label="Other Games" />}
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
        <div className="col-span-full text-xs font-semibold text-muted uppercase tracking-wider px-1 pt-1 pb-2">
            {label}
        </div>
    );
}

/** Divider with label between game sections. */
function SectionDivider({ label }: { label: string }): JSX.Element {
    return (
        <div className="col-span-full flex items-center gap-2 px-1 pt-3 pb-2">
            <div className="flex-1 border-t border-edge" />
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">{label}</span>
            <div className="flex-1 border-t border-edge" />
        </div>
    );
}

// Rows: the `Checkbox` primitive in the desktop panel grid, tap rows (aria-pressed) in the sheet.
// Token colours only in both — every scheme remaps them.

export interface GameItemProps {
    game: GameWithLiked;
    isSelected: boolean;
    onToggle: () => void;
}

export type GameItemRenderer = (props: GameItemProps) => JSX.Element;

/** Sheet row (below 1024px): full-width tap target, pressed while the game is shown. */
export function SheetGameItem({ game, isSelected, onToggle }: GameItemProps): JSX.Element {
    const colors = getGameColors(game.slug);
    return (
        <button type="button" onClick={onToggle} aria-pressed={isSelected}
            className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors ${
                isSelected ? 'bg-success/10 text-foreground' : 'text-muted hover:bg-panel'
            }`}>
            <GameIcon coverUrl={game.coverUrl} icon={colors.icon} />
            <span className="flex-1 text-left text-sm font-medium">{game.name}</span>
            <CheckMark isSelected={isSelected} />
        </button>
    );
}

/** Panel row (1024px and up): the `Checkbox` primitive — visible box, 24px avatar, name. */
export function CheckboxGameItem({ game, isSelected, onToggle }: GameItemProps): JSX.Element {
    const colors = getGameColors(game.slug);
    return (
        <Checkbox checked={isSelected} onChange={onToggle} data-testid="calendar-game-checkbox" label={(
            <span className="flex items-center gap-2 min-w-0">
                <GameIcon coverUrl={game.coverUrl} icon={colors.icon} size="sm" />
                <span className="truncate">{game.name}</span>
            </span>
        )} />
    );
}

/** Cover art, or the game's emoji fallback. Decorative — the name sits beside it. */
function GameIcon({ coverUrl, icon, size = 'md' }: {
    coverUrl: string | null; icon: string; size?: 'sm' | 'md';
}): JSX.Element {
    return (
        <div className={`${size === 'sm' ? 'w-6 h-6' : 'w-8 h-8'} rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center bg-panel`}>
            {coverUrl
                ? <img src={coverUrl} alt="" className="w-full h-full object-cover" />
                : <span className="text-sm" aria-hidden="true">{icon}</span>}
        </div>
    );
}

/** Check indicator for sheet rows. */
function CheckMark({ isSelected }: { isSelected: boolean }): JSX.Element {
    return (
        <div aria-hidden="true" className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected ? 'bg-success border-success' : 'border-edge'
        }`}>
            {isSelected && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
            )}
        </div>
    );
}
