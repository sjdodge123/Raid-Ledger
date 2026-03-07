/**
 * Static mapping of TBC WoW talent URL slugs to their grid positions
 * within each talent tree, used to construct Wowhead talent calculator URLs.
 *
 * Grid positions follow the Wowhead format: row letter (a-i) + column number (1-4).
 * The talent string is built by iterating positions left-to-right, top-to-bottom,
 * with each digit representing points spent. Trees are separated by hyphens.
 *
 * Source: Wowhead TBC Classic talent calculator.
 */

import type { TreePositionMap } from './talent-data/types';
import { DRUID_POSITIONS, MAGE_POSITIONS, PRIEST_POSITIONS, WARLOCK_POSITIONS } from './talent-data/casters';
import { HUNTER_POSITIONS, PALADIN_POSITIONS, ROGUE_POSITIONS, WARRIOR_POSITIONS } from './talent-data/melee';
import { SHAMAN_POSITIONS } from './talent-data/hybrid';

import type { ClassPositionMap } from './talent-data/types';

/**
 * All TBC WoW classes and their talent tree position maps.
 * Key = Blizzard API class name (title case).
 */
export const CLASSIC_TALENT_POSITIONS: Record<string, ClassPositionMap> = {
    Druid: DRUID_POSITIONS,
    Hunter: HUNTER_POSITIONS,
    Mage: MAGE_POSITIONS,
    Paladin: PALADIN_POSITIONS,
    Priest: PRIEST_POSITIONS,
    Rogue: ROGUE_POSITIONS,
    Shaman: SHAMAN_POSITIONS,
    Warlock: WARLOCK_POSITIONS,
    Warrior: WARRIOR_POSITIONS,
};

/**
 * Normalize a Blizzard API talent name to a URL slug for matching.
 * "Nature's Grasp" -> "natures-grasp"
 */
function nameToSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[':]/g, '')
        .replace(/[()]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Build a Wowhead talent string for a single tree from slug-rank pairs.
 * Talents are sorted by grid position; trailing zeros are trimmed.
 */
function buildTreeString(
    treePositionMap: TreePositionMap,
    talentRanks: Record<string, number>,
): string {
    const sortedTalents = Object.entries(treePositionMap)
        .sort(([, posA], [, posB]) => posA.localeCompare(posB));

    const digits = sortedTalents.map(([slug]) => talentRanks[slug] ?? 0);
    let str = digits.join('');
    str = str.replace(/0+$/, '');
    return str || '0';
}

/** Classic talent data shape from Blizzard API */
interface ClassicTalentTree {
    name: string;
    spentPoints: number;
    talents: Array<{
        name: string;
        rank?: number;
        tierIndex?: number;
        columnIndex?: number;
    }>;
}

/** Build tree string from API tier/column positions */
function buildTreeStringFromApi(
    talents: ClassicTalentTree['talents'],
    treePositionMap: TreePositionMap,
): string {
    const posRanks: Record<string, number> = {};
    for (const talent of talents) {
        if (talent.rank && talent.rank > 0 && talent.tierIndex != null && talent.columnIndex != null) {
            const pos = String.fromCharCode(97 + talent.tierIndex) + (talent.columnIndex + 1);
            posRanks[pos] = talent.rank;
        }
    }

    const sortedPositions = Object.values(treePositionMap).sort();
    const digits = sortedPositions.map((pos) => posRanks[pos] ?? 0);
    let str = digits.join('');
    str = str.replace(/0+$/, '');
    return str || '0';
}

/** Check if talents have API position data */
function hasApiPositions(
    talents: ClassicTalentTree['talents'],
): boolean {
    const ranked = talents.filter((t) => t.rank && t.rank > 0);
    if (ranked.length === 0) return false;
    return ranked.every(
        (t) => t.tierIndex != null && t.columnIndex != null,
    );
}

function buildTreeStringForData(treeData: ClassicTalentTree, positionMap: TreePositionMap): string {
    if (hasApiPositions(treeData.talents)) return buildTreeStringFromApi(treeData.talents, positionMap);
    const talentRanks: Record<string, number> = {};
    for (const talent of treeData.talents) {
        if (talent.rank && talent.rank > 0) talentRanks[nameToSlug(talent.name)] = talent.rank;
    }
    return buildTreeString(positionMap, talentRanks);
}

/**
 * Build a complete Wowhead talent string from Classic talent data.
 * Returns null if the class is unknown.
 *
 * @param className - Blizzard API class name (e.g. "Warrior")
 * @param trees - Talent tree data from the Blizzard API
 */
export function buildWowheadTalentString(
    className: string,
    trees: ClassicTalentTree[],
): string | null {
    const classPositions = CLASSIC_TALENT_POSITIONS[className];
    if (!classPositions) return null;

    const treeOrder = Object.keys(classPositions);
    const treeStrings: string[] = [];

    for (const treeName of treeOrder) {
        const positionMap = classPositions[treeName];
        const treeData = trees.find((t) => t.name.toLowerCase() === treeName.toLowerCase());
        if (!treeData) { treeStrings.push('0'); continue; }
        treeStrings.push(buildTreeStringForData(treeData, positionMap));
    }

    // Trim trailing "0" trees
    while (treeStrings.length > 1 && treeStrings[treeStrings.length - 1] === '0') {
        treeStrings.pop();
    }

    return treeStrings.join('-');
}
