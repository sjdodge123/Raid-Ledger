/**
 * Game filter input for the player filters panel (ROK-821).
 * Wraps GameSearchInput with gameId ↔ IgdbGameDto conversion
 * and resolves gameId from URL to a display name via the game registry.
 */
import { useMemo } from 'react';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { GameSearchInput } from '../../events/game-search-input';
import { useGameRegistry } from '../../../hooks/use-game-registry';

interface GameFilterInputProps {
    gameId?: number;
    onChange: (gameId?: number) => void;
}

/** Resolve a numeric gameId to a minimal IgdbGameDto from the registry cache. */
function useResolvedGame(gameId?: number): IgdbGameDto | null {
    const { games } = useGameRegistry();
    return useMemo(() => {
        if (!gameId) return null;
        const match = games.find((g) => g.id === gameId);
        if (!match) return null;
        return { id: match.id, igdbId: null, name: match.name, slug: '', coverUrl: match.coverUrl ?? null };
    }, [gameId, games]);
}

/** Game search typeahead that reads/writes a numeric gameId. */
export function GameFilterInput({ gameId, onChange }: GameFilterInputProps) {
    const resolved = useResolvedGame(gameId);
    const { games } = useGameRegistry();

    const suggestions = useMemo(() =>
        games.slice(0, 10).map((g) => ({
            id: g.id, igdbId: null, name: g.name, slug: '', coverUrl: g.coverUrl ?? null,
        } satisfies IgdbGameDto)), [games]);

    return (
        <div className="[&_label]:!text-muted [&_label]:!text-xs [&_label]:!font-normal [&_label]:!mb-1">
            <GameSearchInput
                value={resolved}
                onChange={(game) => onChange(game?.id ?? undefined)}
                initialSuggestions={suggestions}
            />
        </div>
    );
}
