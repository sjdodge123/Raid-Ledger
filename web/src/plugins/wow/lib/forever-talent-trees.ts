import type { ForeverTalentNodeDto } from '@raid-ledger/contract';
import { ownLookup } from '../../../lib/own-lookup';

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
    return ownLookup(TREE_NAMES, key) ?? FALLBACK_NAMES;
}

/** Blizzard/Wowhead tree names that differ from the in-game tab names above. */
const TREE_NAME_ALIASES: Record<string, string> = { 'feral combat': 'feral' };

/**
 * The class column (0–2, in-game tab order) of a sub-tree name, matched
 * case-insensitively (ROK-2113 T1); undefined for an unknown class or name.
 */
export function foreverClassTreeIndex(characterClass: string | null | undefined, treeName: string): number | undefined {
    const names = ownLookup(TREE_NAMES, characterClass?.trim().toLowerCase() ?? '');
    const raw = treeName.trim().toLowerCase();
    const wanted = ownLookup(TREE_NAME_ALIASES, raw) ?? raw;
    const index = names?.findIndex((n) => n.toLowerCase() === wanted) ?? -1;
    return index >= 0 ? index : undefined;
}

/** "rank/maxRanks", or the bare rank when the max is unknown. */
export function formatForeverRank(node: ForeverTalentNodeDto): string {
    return node.maxRanks !== undefined ? `${node.rank}/${node.maxRanks}` : `${node.rank}`;
}
