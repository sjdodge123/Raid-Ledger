import { useGameRegistry } from '../../../hooks/use-game-registry';
import { resolveWowVariant, type WowVariantSource } from '../lib/wow-variant-config';
import type { WowVariant } from '../lib/wow-era';

/**
 * ROK-1751: the effective WoW variant of a character, including a LedgerLink
 * Forever character whose `gameVariant` and `ruleset` are both null. The game
 * slug comes from the cached game registry (shared `['game-registry']` key,
 * 10-minute staleTime), keyed by the character's `gameId`, so no contract
 * field or extra per-character request is needed.
 */
export function useCharacterWowVariant(character: Omit<WowVariantSource, 'gameSlug'> & { gameId?: number | null | undefined }): WowVariant | null {
    const { games } = useGameRegistry();
    const gameSlug = character.gameId != null ? games.find((g) => g.id === character.gameId)?.slug : undefined;
    return resolveWowVariant({ gameVariant: character.gameVariant, ruleset: character.ruleset, gameSlug });
}
