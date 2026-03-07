import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { useGameSearch } from '../../hooks/use-game-search';

interface GameSearchInputProps {
    value: IgdbGameDto | null;
    onChange: (game: IgdbGameDto | null) => void;
    error?: string;
    /** Games to show immediately when input is focused with no query (e.g. registry games) */
    initialSuggestions?: IgdbGameDto[];
}

function measureDropdownPos(el: HTMLDivElement) {
    const rect = el.getBoundingClientRect();
    return { top: rect.bottom + 8, left: rect.left, width: rect.width };
}

function useDropdownPosition(containerRef: React.RefObject<HTMLDivElement | null>, isOpen: boolean) {
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

    const updateDropdownPos = useCallback(() => {
        const el = containerRef.current;
        if (el) setDropdownPos(measureDropdownPos(el));
    }, [containerRef]);

    useEffect(() => {
        if (!isOpen) return;
        updateDropdownPos();
        window.addEventListener('scroll', updateDropdownPos, true);
        window.addEventListener('resize', updateDropdownPos);
        return () => {
            window.removeEventListener('scroll', updateDropdownPos, true);
            window.removeEventListener('resize', updateDropdownPos);
        };
    }, [isOpen, updateDropdownPos]);

    return { dropdownPos };
}

function SelectedGameBadge({ value }: { value: IgdbGameDto }) {
    return (
        <div className="mt-2 flex items-center gap-2">
            {value.coverUrl && (
                <img src={value.coverUrl} alt={value.name}
                    className="w-8 h-10 object-cover rounded bg-overlay"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            )}
            <span className="text-emerald-400 text-sm font-medium">{value.name}</span>
        </div>
    );
}

function GameOptionItem({ game, isSelected, onSelect }: { game: IgdbGameDto; isSelected: boolean; onSelect: () => void }) {
    return (
        <li role="option" aria-selected={isSelected} onClick={onSelect}
            className="flex items-center gap-3 px-4 py-3 hover:bg-panel cursor-pointer transition-colors">
            {game.coverUrl ? (
                <img src={game.coverUrl} alt={game.name} className="w-10 h-12 object-cover rounded bg-overlay"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
                <div className="w-10 h-12 bg-overlay rounded flex items-center justify-center text-dim">🎮</div>
            )}
            <span className="text-foreground font-medium">{game.name}</span>
        </li>
    );
}

function LocalSourceWarning() {
    return (
        <div className="px-4 py-2 bg-yellow-900/30 border-b border-edge text-yellow-500 text-xs font-medium flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Showing local results (external search unavailable)
        </div>
    );
}

function GameDropdownContent({ query, isLoading, displayGames, source, value, onSelect }: {
    query: string; isLoading: boolean; displayGames: IgdbGameDto[];
    source: string | undefined; value: IgdbGameDto | null; onSelect: (g: IgdbGameDto) => void;
}) {
    if (isLoading && query.length >= 2) {
        return <div className="p-4 text-center text-muted">Searching...</div>;
    }
    if (displayGames.length === 0) {
        return <div className="p-4 text-center text-muted">{query.length >= 2 ? 'No games found' : 'Type to search...'}</div>;
    }
    return (
        <>
            {source === 'local' && query.length >= 2 && <LocalSourceWarning />}
            <ul role="listbox">
                {displayGames.map((game) => (
                    <GameOptionItem key={game.id} game={game} isSelected={value?.id === game.id} onSelect={() => onSelect(game)} />
                ))}
            </ul>
        </>
    );
}

function useOutsideClick(containerRef: React.RefObject<HTMLDivElement | null>, isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (containerRef.current && !containerRef.current.contains(target) &&
                !(target instanceof Element && target.closest('[data-game-dropdown]'))) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, containerRef, onClose]);
}

function GameDropdownPortal({ dropdownPos, query, isLoading, displayGames, source, value, onSelect }: {
    dropdownPos: { top: number; left: number; width: number };
    query: string; isLoading: boolean; displayGames: IgdbGameDto[];
    source: string | undefined; value: IgdbGameDto | null; onSelect: (g: IgdbGameDto) => void;
}) {
    return createPortal(
        <div data-game-dropdown className="fixed z-[9999] bg-surface border border-edge rounded-lg shadow-xl max-h-64 overflow-y-auto"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}>
            <GameDropdownContent query={query} isLoading={isLoading} displayGames={displayGames}
                source={source} value={value} onSelect={onSelect} />
        </div>,
        document.body,
    );
}

/**
 * Game search input with autocomplete dropdown.
 * Searches IGDB via backend API with debouncing.
 */
function useGameSearchState(value: IgdbGameDto | null, onChange: (game: IgdbGameDto | null) => void, initialSuggestions?: IgdbGameDto[]) {
    const [query, setQuery] = useState(value?.name ?? '');
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { data: searchResult, isLoading } = useGameSearch(query, isOpen);
    const { dropdownPos } = useDropdownPosition(containerRef, isOpen);
    const closeDropdown = useCallback(() => setIsOpen(false), []);
    useOutsideClick(containerRef, isOpen, closeDropdown);
    const handleSelect = (game: IgdbGameDto) => { onChange(game); setQuery(game.name); setIsOpen(false); };
    const handleClear = () => { onChange(null); setQuery(''); setIsOpen(false); inputRef.current?.focus(); };
    const hasInitialSuggestions = !!(initialSuggestions && initialSuggestions.length > 0);
    const showDropdown = isOpen && (query.length >= 2 || (hasInitialSuggestions && query.length < 2));
    const displayGames = query.length >= 2 ? (searchResult?.data ?? []) : (initialSuggestions ?? []);
    return { query, setQuery, isOpen, setIsOpen, containerRef, inputRef, isLoading, source: searchResult?.meta?.source, dropdownPos, handleSelect, handleClear, hasInitialSuggestions, showDropdown, displayGames };
}

export function GameSearchInput({ value, onChange, error, initialSuggestions }: GameSearchInputProps) {
    const s = useGameSearchState(value, onChange, initialSuggestions);
    return (
        <div className="relative" ref={s.containerRef}>
            <label htmlFor="game-search" className="block text-sm font-medium text-secondary mb-2">Game</label>
            <SearchInputField inputRef={s.inputRef} query={s.query} value={value} isLoading={s.isLoading}
                error={error}
                onInputChange={(e) => { s.setQuery(e.target.value); s.setIsOpen(true); if (value && e.target.value !== value.name) onChange(null); }}
                onFocus={() => (s.query.length >= 2 || s.hasInitialSuggestions) && s.setIsOpen(true)}
                onClear={s.handleClear} />
            {value && <SelectedGameBadge value={value} />}
            {s.showDropdown && s.dropdownPos && <GameDropdownPortal dropdownPos={s.dropdownPos} query={s.query}
                isLoading={s.isLoading} displayGames={s.displayGames} source={s.source} value={value} onSelect={s.handleSelect} />}
            {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </div>
    );
}

function SearchInputField({ inputRef, query, value, isLoading, error, onInputChange, onFocus, onClear }: {
    inputRef: React.RefObject<HTMLInputElement | null>; query: string; value: IgdbGameDto | null;
    isLoading: boolean; error?: string;
    onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onFocus: () => void; onClear: () => void;
}) {
    return (
        <div className="relative">
            <input ref={inputRef} id="game-search" type="text" value={query}
                onChange={onInputChange} onFocus={onFocus} placeholder="Search for a game..."
                className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${error ? 'border-red-500' : value ? 'border-emerald-500' : 'border-edge'}`} />
            {value && (
                <button type="button" onClick={onClear}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-foreground transition-colors"
                    aria-label="Clear selection">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
            {isLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 border-2 border-dim border-t-emerald-500 rounded-full animate-spin" />
                </div>
            )}
        </div>
    );
}
