/**
 * Canonical primary / secondary profession lists for WoW.
 *
 * The category (primary vs secondary) is fixed across game variants —
 * Cooking is always secondary, Tailoring is always primary, etc. Some
 * professions are gated by expansion availability (Inscription was added
 * in Wrath, Jewelcrafting in BC, Archaeology in Cataclysm) but their
 * category never changes once introduced.
 */

export const PRIMARY_PROFESSIONS = [
    'Alchemy',
    'Blacksmithing',
    'Enchanting',
    'Engineering',
    'Herbalism',
    'Inscription',
    'Jewelcrafting',
    'Leatherworking',
    'Mining',
    'Skinning',
    'Tailoring',
] as const;

export const SECONDARY_PROFESSIONS = [
    'Cooking',
    'Fishing',
    'First Aid',
    'Archaeology',
] as const;

export type ProfessionCategory = 'primary' | 'secondary';

export function getProfessionOptions(category: ProfessionCategory): readonly string[] {
    return category === 'primary' ? PRIMARY_PROFESSIONS : SECONDARY_PROFESSIONS;
}
