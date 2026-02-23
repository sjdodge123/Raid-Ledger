import type { EquipmentItemDto } from '@raid-ledger/contract';
import { WowItemCard } from './wow-item-card';
import { getWowheadItemUrl, getWowheadDataSuffix } from '../lib/wowhead-urls';
import './item-comparison.css';

/**
 * WoW class → equippable armor types.
 * Used to determine if a loot item is wearable by the character.
 */
const CLASS_ARMOR_PROFICIENCY: Record<string, string[]> = {
    warrior: ['Plate', 'Mail', 'Leather', 'Cloth'],
    paladin: ['Plate', 'Mail', 'Leather', 'Cloth'],
    'death knight': ['Plate', 'Mail', 'Leather', 'Cloth'],
    hunter: ['Mail', 'Leather', 'Cloth'],
    shaman: ['Mail', 'Leather', 'Cloth'],
    druid: ['Leather', 'Cloth'],
    rogue: ['Leather', 'Cloth'],
    monk: ['Leather', 'Cloth'],
    'demon hunter': ['Leather', 'Cloth'],
    mage: ['Cloth'],
    warlock: ['Cloth'],
    priest: ['Cloth'],
};

/** Armor subclass values that are subject to proficiency checks */
const ARMOR_SUBCLASSES = new Set(['Cloth', 'Leather', 'Mail', 'Plate']);

/**
 * Check whether a loot item's armor type is equippable by the character's class.
 * Returns null if we can't determine (missing data), true/false otherwise.
 */
function isItemEquippable(
    characterClass: string | null | undefined,
    lootItemSubclass: string | null | undefined,
): boolean | null {
    if (!characterClass || !lootItemSubclass) return null;
    if (!ARMOR_SUBCLASSES.has(lootItemSubclass)) return null;
    const proficiencies = CLASS_ARMOR_PROFICIENCY[characterClass.toLowerCase()];
    if (!proficiencies) return null;
    return proficiencies.includes(lootItemSubclass);
}

interface ItemComparisonProps {
    /** The reward item's level (may be null if unknown) */
    rewardItemLevel: number | null;
    /** The currently equipped item in the matching slot */
    equippedItem: EquipmentItemDto | undefined;
    /** WoW game variant for Wowhead URLs */
    gameVariant: string | null;
    /** Character's WoW class (e.g. "Druid", "Warrior") for armor proficiency checks */
    characterClass?: string | null;
    /** Armor subclass of the loot/reward item (e.g. "Plate", "Mail", "Leather", "Cloth") */
    lootItemSubclass?: string | null;
}

/**
 * Reusable component that shows the user's currently equipped item
 * in the same slot as a quest reward, with an item level delta indicator.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 */
export function ItemComparison({
    rewardItemLevel,
    equippedItem,
    gameVariant,
    characterClass,
    lootItemSubclass,
}: ItemComparisonProps) {
    const equippable = isItemEquippable(characterClass, lootItemSubclass);

    // If the item is not equippable by this class, show that instead of comparison
    if (equippable === false) {
        return (
            <div className="item-comparison item-comparison--not-equippable">
                <span className="item-comparison__not-equippable">
                    Cannot equip {lootItemSubclass}
                </span>
            </div>
        );
    }

    if (!equippedItem) {
        return (
            <div className="item-comparison">
                <span className="item-comparison__label">Equipped:</span>
                <span className="item-comparison__empty">Empty slot</span>
            </div>
        );
    }

    const wowheadSuffix = getWowheadDataSuffix(gameVariant);

    // Calculate iLvl delta
    const delta = rewardItemLevel && equippedItem.itemLevel
        ? rewardItemLevel - equippedItem.itemLevel
        : null;

    let deltaClass = 'item-comparison__delta--neutral';
    let deltaText = '';
    if (delta !== null) {
        if (delta > 0) {
            deltaClass = 'item-comparison__delta--upgrade';
            deltaText = `▲ +${delta} iLvl`;
        } else if (delta < 0) {
            deltaClass = 'item-comparison__delta--downgrade';
            deltaText = `▼ ${delta} iLvl`;
        } else {
            deltaText = '= Same iLvl';
        }
    }

    return (
        <div className="item-comparison">
            <span className="item-comparison__label">Equipped:</span>
            <WowItemCard
                itemId={equippedItem.itemId}
                name={equippedItem.name}
                quality={equippedItem.quality}
                slot={equippedItem.slot}
                subclass={equippedItem.itemSubclass}
                itemLevel={equippedItem.itemLevel}
                iconUrl={equippedItem.iconUrl}
                enchant={equippedItem.enchantments?.[0]?.displayString}
                wowheadUrl={getWowheadItemUrl(equippedItem.itemId, gameVariant)}
                wowheadData={`item=${equippedItem.itemId}&${wowheadSuffix}`}
            />
            {deltaText && (
                <span className={`item-comparison__delta ${deltaClass}`}>
                    {deltaText}
                </span>
            )}
        </div>
    );
}

