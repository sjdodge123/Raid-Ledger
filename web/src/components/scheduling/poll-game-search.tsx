/**
 * Game search component for the CreatePollModal (ROK-977).
 * Wraps the game search with test IDs for smoke test compatibility.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { useGameSearch } from '../../hooks/use-game-search';

interface PollGameSearchProps {
  value: IgdbGameDto | null;
  onChange: (game: IgdbGameDto | null) => void;
}

/** Hook for search state and outside-click handling. */
function usePollGameSearchState(
  value: IgdbGameDto | null,
  onChange: (game: IgdbGameDto | null) => void,
) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: searchResult, isLoading } = useGameSearch(query, isOpen);
  const games = searchResult?.data ?? [];

  const handleSelect = (game: IgdbGameDto) => {
    onChange(game);
    setQuery(game.name);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
  };

  const closeOnOutsideClick = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isOpen, closeOnOutsideClick]);

  return {
    query, setQuery, isOpen, setIsOpen, containerRef,
    isLoading, games, handleSelect, handleClear,
  };
}

/** Game search with inline dropdown (not portal-based). */
export function PollGameSearch({ value, onChange }: PollGameSearchProps) {
  const s = usePollGameSearchState(value, onChange);

  return (
    <div ref={s.containerRef} className="relative">
      <label className="block text-sm font-medium text-secondary mb-2">Game</label>
      <SearchInput
        query={s.query}
        value={value}
        onInput={(v) => { s.setQuery(v); s.setIsOpen(true); if (value) onChange(null); }}
        onFocus={() => s.query.length >= 2 && s.setIsOpen(true)}
        onClear={s.handleClear}
      />
      {value && <SelectedBadge name={value.name} coverUrl={value.coverUrl} />}
      {s.isOpen && s.query.length >= 2 && (
        <GameDropdown
          games={s.games}
          isLoading={s.isLoading}
          value={value}
          onSelect={s.handleSelect}
        />
      )}
    </div>
  );
}

function SearchInput({ query, value, onInput, onFocus, onClear }: {
  query: string; value: IgdbGameDto | null;
  onInput: (v: string) => void; onFocus: () => void; onClear: () => void;
}) {
  return (
    <div className="relative">
      <input
        data-testid="game-search-input"
        type="text"
        value={query}
        onChange={(e) => onInput(e.target.value)}
        onFocus={onFocus}
        placeholder="Search for a game..."
        aria-label="Search game"
        className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${value ? 'border-emerald-500' : 'border-edge'}`}
      />
      {value && (
        <button type="button" onClick={onClear} aria-label="Clear selection"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SelectedBadge({ name, coverUrl }: { name: string; coverUrl?: string | null }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      {coverUrl && (
        <img src={coverUrl} alt={name} className="w-8 h-10 object-cover rounded bg-overlay" />
      )}
      <span className="text-emerald-400 text-sm font-medium">{name}</span>
    </div>
  );
}

function GameDropdown({ games, isLoading, value, onSelect }: {
  games: IgdbGameDto[]; isLoading: boolean;
  value: IgdbGameDto | null; onSelect: (g: IgdbGameDto) => void;
}) {
  return (
    <div
      data-testid="game-search-results"
      className="absolute z-50 mt-1 w-full bg-surface border border-edge rounded-lg shadow-xl max-h-64 overflow-y-auto"
    >
      {isLoading && <div className="p-3 text-sm text-muted">Searching...</div>}
      {!isLoading && games.length === 0 && (
        <div className="p-3 text-sm text-muted">No games found</div>
      )}
      <ul role="listbox">
        {games.map((game) => (
          <li
            key={game.id}
            role="option"
            data-testid="game-option"
            aria-selected={value?.id === game.id}
            onClick={() => onSelect(game)}
            className="flex items-center gap-3 px-4 py-3 hover:bg-panel cursor-pointer transition-colors"
          >
            {game.coverUrl && (
              <img src={game.coverUrl} alt={game.name} className="w-10 h-12 object-cover rounded bg-overlay" />
            )}
            <span className="text-foreground font-medium">{game.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
