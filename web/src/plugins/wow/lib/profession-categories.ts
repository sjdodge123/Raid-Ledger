/**
 * Canonical primary / secondary profession lists for WoW, with
 * per-era availability filtering.
 *
 * Category (primary vs secondary) is fixed across game variants —
 * Cooking is always secondary, Tailoring is always primary, etc. But
 * availability varies by era:
 *   • Jewelcrafting was added in The Burning Crusade
 *   • Inscription was added in Wrath of the Lich King
 *   • Archaeology was added in Cataclysm
 *   • First Aid was removed from retail in Battle for Azeroth (still
 *     in every Classic flavor)
 */

import type { WowEra } from './wow-era';
import { getWowEra } from './wow-era';

export type ProfessionCategory = 'primary' | 'secondary';

const VANILLA_PRIMARY = [
    'Alchemy', 'Blacksmithing', 'Enchanting', 'Engineering',
    'Herbalism', 'Leatherworking', 'Mining', 'Skinning', 'Tailoring',
] as const;

const PRIMARY_BY_ERA: Record<WowEra, readonly string[]> = {
    vanilla: VANILLA_PRIMARY,
    bc: [...VANILLA_PRIMARY, 'Jewelcrafting'],
    wrath: [...VANILLA_PRIMARY, 'Jewelcrafting', 'Inscription'],
    cataclysm: [...VANILLA_PRIMARY, 'Jewelcrafting', 'Inscription'],
    mop: [...VANILLA_PRIMARY, 'Jewelcrafting', 'Inscription'],
    retail: [...VANILLA_PRIMARY, 'Jewelcrafting', 'Inscription'],
};

const SECONDARY_BY_ERA: Record<WowEra, readonly string[]> = {
    vanilla: ['Cooking', 'Fishing', 'First Aid'],
    bc: ['Cooking', 'Fishing', 'First Aid'],
    wrath: ['Cooking', 'Fishing', 'First Aid'],
    cataclysm: ['Cooking', 'Fishing', 'First Aid', 'Archaeology'],
    mop: ['Cooking', 'Fishing', 'First Aid', 'Archaeology'],
    // Retail removed First Aid in Battle for Azeroth.
    retail: ['Cooking', 'Fishing', 'Archaeology'],
};

/** Available profession options for the given category in the given game variant. */
export function getProfessionOptions(
    category: ProfessionCategory,
    gameSlug: string | null | undefined,
): readonly string[] {
    const era = getWowEra(gameSlug);
    return category === 'primary' ? PRIMARY_BY_ERA[era] : SECONDARY_BY_ERA[era];
}

/** How many entries the given category supports (primary always 2, secondary varies). */
export function getMaxEntriesForCategory(
    category: ProfessionCategory,
    gameSlug: string | null | undefined,
): number {
    if (category === 'primary') return 2;
    return getProfessionOptions('secondary', gameSlug).length;
}
