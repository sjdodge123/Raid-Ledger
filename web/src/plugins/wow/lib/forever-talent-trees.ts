import type { ForeverTalentNodeDto } from '@raid-ledger/contract';

/**
 * WoW: Forever sub-tree names per class, in in-game tab order (ROK-1744 R-B).
 * Static vanilla data; the addon's `tree` index 0/1/2 maps to these in order.
 */
const TREE_NAMES: Record<string, readonly [string, string, string]> = {
    warrior: ['Arms', 'Fury', 'Protection'],
    paladin: ['Holy', 'Protection', 'Retribution'],
    hunter: ['Beast Mastery', 'Marksmanship', 'Survival'],
    rogue: ['Assassination', 'Combat', 'Subtlety'],
    priest: ['Discipline', 'Holy', 'Shadow'],
    shaman: ['Elemental', 'Enhancement', 'Restoration'],
    mage: ['Arcane', 'Fire', 'Frost'],
    warlock: ['Affliction', 'Demonology', 'Destruction'],
    druid: ['Balance', 'Feral', 'Restoration'],
};

const FALLBACK_NAMES = ['Tree 1', 'Tree 2', 'Tree 3'] as const;

/** The three sub-tree names for a class (case-insensitive); "Tree 1/2/3" when unknown. */
export function foreverTreeNames(characterClass: string | null | undefined): readonly string[] {
    const key = characterClass?.trim().toLowerCase() ?? '';
    return TREE_NAMES[key] ?? FALLBACK_NAMES;
}

/** "rank/maxRanks", or the bare rank when the max is unknown. */
export function formatForeverRank(node: ForeverTalentNodeDto): string {
    return node.maxRanks !== undefined ? `${node.rank}/${node.maxRanks}` : `${node.rank}`;
}
