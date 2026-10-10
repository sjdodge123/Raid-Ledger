import { useGameRegistry } from '../../../hooks/use-game-registry';
import { resolveWowVariant, type WowVariantSource } from '../lib/wow-variant-config';
import type { WowVariant } from '../lib/wow-era';

/** The resolved variant plus whether it is still waiting on the game registry. */
export interface CharacterWowVariantState {
    variant: WowVariant | null;
    /** True while the registry is loading and the variant/ruleset alone resolved nothing. */
    isResolving: boolean;
}

/**
 * ROK-1751: the effective WoW variant of a character, including a LedgerLink
 * Forever character whose `gameVariant` and `ruleset` are both null. The game
 * slug comes from the cached game registry (shared `['game-registry']` key,
 * 10-minute staleTime), keyed by the character's `gameId`, so no contract
 * field or extra per-character request is needed. `isResolving` lets callers
 * hold variant-specific copy until the registry answers (review MINOR 1).
 */
export function useCharacterWowVariant(
    character: Omit<WowVariantSource, 'gameSlug'> & { gameId?: number | null | undefined },
): CharacterWowVariantState {
    const { games, isLoading } = useGameRegistry();
    const gameSlug = character.gameId != null ? games.find((g) => g.id === character.gameId)?.slug : undefined;
    const variant = resolveWowVariant({ gameVariant: character.gameVariant, ruleset: character.ruleset, gameSlug });
    return { variant, isResolving: variant === null && character.gameId != null && isLoading };
}
