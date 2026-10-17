import { useMemo } from 'react';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { useGameRegistry } from '../../../hooks/use-game-registry';

/** Expose registryGameId lookup for parent forms that need it (e.g., for submission DTO) */
export function useRegistryGameId(game: IgdbGameDto | null): number | undefined {
    const { games: registryGames } = useGameRegistry();
    return useMemo(() => {
        if (!game?.name && !game?.slug) return undefined;
        const match = registryGames.find(
            (g) => (game?.name && g.name.toLowerCase() === game.name.toLowerCase()) || g.slug === game?.slug,
        );
        return match?.id;
    }, [game, registryGames]);
}
