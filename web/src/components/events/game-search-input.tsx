import { useState, useRef, useEffect } from 'react';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { useGameSearch } from '../../hooks/use-game-search';

interface GameSearchInputProps {
    value: IgdbGameDto | null;
    onChange: (game: IgdbGameDto | null) => void;
    error?: string;
}

/**
 * Game search input with autocomplete dropdown.
 * Searches IGDB via backend API with debouncing.
 */
export function GameSearchInput({ value, onChange, error }: GameSearchInputProps) {
    const [query, setQuery] = useState(value?.name ?? '');
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Query games API - hook handles debouncing internally (ROK-161)
    const { data: searchResult, isLoading } = useGameSearch(query, isOpen);
    const games = searchResult?.data ?? [];
    const source = searchResult?.meta?.source;

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Handle game selection
    function handleSelect(game: IgdbGameDto) {
        onChange(game);
        setQuery(game.name);
        setIsOpen(false);
    }

    // Handle clearing selection
    function handleClear() {
        onChange(null);
        setQuery('');
        setIsOpen(false);
        inputRef.current?.focus();
    }

    // Handle input change
    function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        const newValue = e.target.value;
        setQuery(newValue);
        setIsOpen(true);

        // Clear selection if user modifies the text
        if (value && newValue !== value.name) {
            onChange(null);
        }
    }

    const showDropdown = isOpen && query.length >= 2;

    return (
        <div className="relative" ref={containerRef}>
            <label htmlFor="game-search" className="block text-sm font-medium text-slate-300 mb-2">
                Game
            </label>
            <div className="relative">
                <input
                    ref={inputRef}
                    id="game-search"
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    onFocus={() => query.length >= 2 && setIsOpen(true)}
                    placeholder="Search for a game..."
                    className={`w-full px-4 py-3 bg-slate-800 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${error ? 'border-red-500' : value ? 'border-emerald-500' : 'border-slate-700'
                        }`}
                />

                {/* Clear button */}
                {value && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white transition-colors"
                        aria-label="Clear selection"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}

                {/* Loading indicator */}
                {isLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-5 h-5 border-2 border-slate-500 border-t-emerald-500 rounded-full animate-spin" />
                    </div>
                )}
            </div>

            {/* Selected game badge */}
            {value && (
                <div className="mt-2 flex items-center gap-2">
                    {value.coverUrl && (
                        <img
                            src={value.coverUrl}
                            alt={value.name}
                            className="w-8 h-10 object-cover rounded bg-slate-700"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                            }}
                        />
                    )}
                    <span className="text-emerald-400 text-sm font-medium">{value.name}</span>
                </div>
            )}

            {/* Dropdown */}
            {showDropdown && (
                <div className="absolute z-50 w-full mt-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                    {isLoading ? (
                        <div className="p-4 text-center text-slate-400">
                            Searching...
                        </div>
                    ) : games.length === 0 ? (
                        <div className="p-4 text-center text-slate-400">
                            No games found
                        </div>
                    ) : (
                        <>
                            {source === 'local' && (
                                <div className="px-4 py-2 bg-yellow-900/30 border-b border-slate-700 text-yellow-500 text-xs font-medium flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    Showing local results (external search unavailable)
                                </div>
                            )}
                            <ul role="listbox">
                                {games.map((game) => (
                                    <li
                                        key={game.id}
                                        role="option"
                                        aria-selected={value?.id === game.id}
                                        onClick={() => handleSelect(game)}
                                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 cursor-pointer transition-colors"
                                    >
                                        {game.coverUrl ? (
                                            <img
                                                src={game.coverUrl}
                                                alt={game.name}
                                                className="w-10 h-12 object-cover rounded bg-slate-700"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                }}
                                            />
                                        ) : (
                                            <div className="w-10 h-12 bg-slate-700 rounded flex items-center justify-center text-slate-500">
                                                🎮
                                            </div>
                                        )}
                                        <span className="text-white font-medium">{game.name}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            )}

            {error && (
                <p className="mt-1 text-sm text-red-400">{error}</p>
            )}
        </div>
    );
}
