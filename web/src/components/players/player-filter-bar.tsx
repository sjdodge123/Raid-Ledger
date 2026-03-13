/**
 * Editable filter bar for the players page (ROK-803).
 * Pre-populates from URL search params and syncs changes back to the URL.
 */
import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useGameRegistry } from '../../hooks/use-game-registry';

/** Source filter options for the dropdown. */
const SOURCE_OPTIONS = [
    { value: '', label: 'All Sources' },
    { value: 'steam_library', label: 'Owns (Steam)' },
    { value: 'steam_wishlist', label: 'Wishlisted (Steam)' },
] as const;

/**
 * Editable filter bar that reads/writes URL search params.
 * Shows game filter input and source dropdown.
 * @returns Filter bar JSX element
 */
export function PlayerFilterBar(): JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();
    const source = searchParams.get('source') ?? '';
    const gameId = searchParams.get('gameId') ?? '';
    const hasFilters = source !== '' || gameId !== '';
    const gameName = useGameName(gameId);

    return (
        <div className="flex flex-wrap items-center gap-3 bg-panel border border-edge rounded-lg px-4 py-3">
            <GameIdInput gameId={gameId} gameName={gameName} onGameIdChange={(v) => updateParam(searchParams, setSearchParams, 'gameId', v)} />
            <SourceSelect source={source} onSourceChange={(v) => updateParam(searchParams, setSearchParams, 'source', v)} />
            {hasFilters && <ClearButton onClick={() => clearFilters(setSearchParams)} />}
        </div>
    );
}

/** Resolve a gameId string to a game name from the registry, or null. */
function useGameName(gameId: string): string | null {
    const { games } = useGameRegistry();
    if (!gameId) return null;
    const id = parseInt(gameId, 10);
    if (Number.isNaN(id)) return null;
    return games.find((g) => g.id === id)?.name ?? null;
}

/** Resolved game name badge with dismiss button. */
function GameNameBadge({ gameName, onClear }: {
    gameName: string;
    onClear: () => void;
}): JSX.Element {
    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Game</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded text-emerald-400 text-sm">
                {gameName}
                <button type="button" onClick={onClear} aria-label="Remove game filter" className="hover:text-emerald-300 transition-colors">
                    <XMarkIcon className="w-3.5 h-3.5" />
                </button>
            </span>
        </div>
    );
}

/** Game filter display: shows game name badge when resolved, raw input otherwise. */
function GameIdInput({ gameId, gameName, onGameIdChange }: {
    gameId: string;
    gameName: string | null;
    onGameIdChange: (value: string) => void;
}): JSX.Element {
    if (gameId && gameName) {
        return <GameNameBadge gameName={gameName} onClear={() => onGameIdChange('')} />;
    }
    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Game</span>
            <input
                type="text"
                aria-label="Game"
                value={gameId}
                onChange={(e) => onGameIdChange(e.target.value)}
                placeholder="Game ID"
                className="w-24 px-2 py-1.5 bg-surface border border-edge rounded text-foreground text-sm placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
        </label>
    );
}

/** Source filter dropdown. */
function SourceSelect({ source, onSourceChange }: {
    source: string;
    onSourceChange: (value: string) => void;
}): JSX.Element {
    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Source</span>
            <select
                aria-label="Source"
                value={source}
                onChange={(e) => onSourceChange(e.target.value)}
                className="px-2 py-1.5 bg-surface border border-edge rounded text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
                {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </label>
    );
}

/** Clear all filters button. */
function ClearButton({ onClick }: { onClick: () => void }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Clear filters"
            className="ml-auto flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
            <XMarkIcon className="w-4 h-4" />
            Clear
        </button>
    );
}

/** Update a single URL search param. */
function updateParam(
    current: URLSearchParams,
    setSearchParams: ReturnType<typeof useSearchParams>[1],
    key: string,
    value: string,
): void {
    const next = new URLSearchParams(current);
    if (value) {
        next.set(key, value);
    } else {
        next.delete(key);
    }
    setSearchParams(next, { replace: true });
}

/** Clear all filter-related search params. */
function clearFilters(
    setSearchParams: ReturnType<typeof useSearchParams>[1],
): void {
    setSearchParams({}, { replace: true });
}
