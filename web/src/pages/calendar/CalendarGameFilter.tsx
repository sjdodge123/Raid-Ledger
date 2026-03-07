import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Modal } from '../../components/ui/modal';
import { getGameColors } from '../../constants/game-colors';

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
}

/** Mobile bottom sheet for game filtering */
export function CalendarGameFilterSheet({
    isOpen, onClose, allKnownGames, selectedGames,
    toggleGame, selectAllGames, deselectAllGames,
}: CalendarGameFilterSheetProps): JSX.Element {
    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} title="Filter by Game">
            <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted">{selectedGames.size} of {allKnownGames.length} selected</span>
                <div className="flex gap-2">
                    <button type="button" onClick={selectAllGames} className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">All</button>
                    <button type="button" onClick={deselectAllGames} className="text-sm text-muted hover:text-foreground transition-colors">None</button>
                </div>
            </div>
            <div className="space-y-1">
                {allKnownGames.map((game) => (
                    <MobileGameFilterItem key={game.slug} game={game} isSelected={selectedGames.has(game.slug)} onToggle={() => toggleGame(game.slug)} />
                ))}
            </div>
        </BottomSheet>
    );
}

/** Single game item in the mobile filter sheet */
function MobileGameFilterItem({ game, isSelected, onToggle }: {
    game: GameInfo; isSelected: boolean; onToggle: () => void;
}): JSX.Element {
    const colors = getGameColors(game.slug);
    return (
        <button onClick={onToggle}
            className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors ${
                isSelected ? 'bg-emerald-500/10 text-foreground' : 'text-muted hover:bg-panel'
            }`}>
            <div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center bg-panel">
                {game.coverUrl ? (
                    <img src={game.coverUrl} alt={game.name} className="w-full h-full object-cover" />
                ) : (
                    <span className="text-sm">{colors.icon}</span>
                )}
            </div>
            <span className="flex-1 text-left text-sm font-medium">{game.name}</span>
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-edge'
            }`}>
                {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                )}
            </div>
        </button>
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
}

/** Desktop overflow modal for game filters */
export function CalendarGameFilterModal({
    isOpen, onClose, allKnownGames, selectedGames,
    toggleGame, selectAllGames, deselectAllGames,
}: CalendarGameFilterModalProps): JSX.Element {
    const [filterSearch, setFilterSearch] = useState('');

    const filteredModalGames = useMemo(() => {
        if (!filterSearch.trim()) return allKnownGames;
        const q = filterSearch.toLowerCase();
        return allKnownGames.filter((g) => g.name.toLowerCase().includes(q));
    }, [allKnownGames, filterSearch]);

    return (
        <Modal isOpen={isOpen} onClose={() => { onClose(); setFilterSearch(''); }} title="Filter by Game" maxWidth="max-w-sm">
            <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted">{selectedGames.size} of {allKnownGames.length} selected</span>
                <div className="flex gap-2">
                    <button type="button" onClick={selectAllGames} className="filter-action-btn">All</button>
                    <button type="button" onClick={deselectAllGames} className="filter-action-btn">None</button>
                </div>
            </div>
            <input type="text" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Search games..."
                className="w-full px-3 py-2 mb-3 rounded-lg bg-base border border-edge text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-emerald-500 transition-colors"
                ref={(el) => el?.focus()} />
            <div className="game-filter-list" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                {filteredModalGames.map((game) => {
                    const isSelected = selectedGames.has(game.slug);
                    const colors = getGameColors(game.slug);
                    return (
                        <label key={game.slug} className={`game-filter-item ${isSelected ? 'selected' : ''}`}
                            style={{ '--game-color': colors.bg, '--game-border': colors.border } as React.CSSProperties}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleGame(game.slug)} className="game-filter-checkbox" />
                            <div className="game-filter-icon">
                                {game.coverUrl ? (<img src={game.coverUrl} alt={game.name} className="game-filter-cover" />) : (<span className="game-filter-emoji">{colors.icon}</span>)}
                            </div>
                            <span className="game-filter-name">{game.name}</span>
                        </label>
                    );
                })}
            </div>
        </Modal>
    );
}
