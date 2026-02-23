import type { EquipmentItemDto } from '@raid-ledger/contract';
import { WowItemCard } from './wow-item-card';
import { getWowheadItemUrl, getWowheadDataSuffix } from '../lib/wowhead-urls';
import './item-comparison.css';

/** Armor types that are restricted by class proficiency */
const ARMOR_TYPES = ['Cloth', 'Leather', 'Mail', 'Plate'] as const;

/** Which armor types each WoW class can equip */
const CLASS_ARMOR_PROFICIENCY: Record<string, string[]> = {
    'Warrior': ['Plate', 'Mail', 'Leather', 'Cloth'],
    'Paladin': ['Plate', 'Mail', 'Leather', 'Cloth'],
    'Death Knight': ['Plate', 'Mail', 'Leather', 'Cloth'],
    'Hunter': ['Mail', 'Leather', 'Cloth'],
    'Shaman': ['Mail', 'Leather', 'Cloth'],
    'Rogue': ['Leather', 'Cloth'],
    'Druid': ['Leather', 'Cloth'],
    'Monk': ['Leather', 'Cloth'],
    'Demon Hunter': ['Leather', 'Cloth'],
    'Priest': ['Cloth'],
    'Mage': ['Cloth'],
    'Warlock': ['Cloth'],
    'Evoker': ['Cloth'],
};

interface ItemComparisonProps {
    /** The reward item's level (may be null if unknown) */
    rewardItemLevel: number | null;
    /** The currently equipped item in the matching slot */
    equippedItem: EquipmentItemDto | undefined;
    /** WoW game variant for Wowhead URLs */
    gameVariant: string | null;
    /** Character class name for armor proficiency check */
    characterClass?: string | null;
    /** Loot item's subclass (armor/weapon type) for equipability check */
    lootItemSubclass?: string | null;
}

/**
 * Check if a given armor subclass is equippable by a character class.
 * Returns true if equippable, unknown class, unknown subclass, or non-armor item.
 */
function isArmorEquippable(
    characterClass: string | null | undefined,
    itemSubclass: string | null | undefined,
): boolean {
    if (!characterClass || !itemSubclass) return true;
    // Only restrict armor types; weapons/jewelry/etc. pass through
    if (!ARMOR_TYPES.includes(itemSubclass as typeof ARMOR_TYPES[number])) return true;
    const proficiencies = CLASS_ARMOR_PROFICIENCY[characterClass];
    if (!proficiencies) return true; // Unknown class — don't restrict
    return proficiencies.includes(itemSubclass);
}

/**
 * Reusable component that shows the user's currently equipped item
 * in the same slot as a quest reward, with an item level delta indicator.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 * ROK-454: Armor proficiency equipability check
 */
export function ItemComparison({
    rewardItemLevel,
    equippedItem,
    gameVariant,
    characterClass,
    lootItemSubclass,
}: ItemComparisonProps) {
    // Check equipability when both characterClass and lootItemSubclass are provided
    if (!isArmorEquippable(characterClass, lootItemSubclass)) {
        return (
            <div className="item-comparison">
                <span className="item-comparison__delta item-comparison__delta--downgrade">
                    Not equippable by {characterClass}
                </span>
            </div>
        );
    }

    if (!equippedItem) {
        return (
            <div className="item-comparison">
                <span className="item-comparison__label">Equipped:</span>
                <span className="item-comparison__empty">Empty slot</span>
                {rewardItemLevel && (
                    <span className="item-comparison__delta item-comparison__delta--upgrade">
                        ▲ Upgrade
                    </span>
                )}
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
