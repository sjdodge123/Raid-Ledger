import type { EquipmentItemDto } from '@raid-ledger/contract';
import { WowItemCard } from './wow-item-card';
import { getWowheadItemUrl, getWowheadDataSuffix } from '../lib/wowhead-urls';
import './item-comparison.css';

/**
 * WoW class → equippable item subclass types.
 * Covers armor (Cloth/Leather/Mail/Plate) and shields.
 */
const CLASS_EQUIP_PROFICIENCY: Record<string, Set<string>> = {
    warrior: new Set(['Plate', 'Mail', 'Leather', 'Cloth', 'Shield']),
    paladin: new Set(['Plate', 'Mail', 'Leather', 'Cloth', 'Shield']),
    'death knight': new Set(['Plate', 'Mail', 'Leather', 'Cloth']),
    hunter: new Set(['Mail', 'Leather', 'Cloth']),
    shaman: new Set(['Mail', 'Leather', 'Cloth', 'Shield']),
    druid: new Set(['Leather', 'Cloth']),
    rogue: new Set(['Leather', 'Cloth']),
    monk: new Set(['Leather', 'Cloth']),
    'demon hunter': new Set(['Leather', 'Cloth']),
    mage: new Set(['Cloth']),
    warlock: new Set(['Cloth']),
    priest: new Set(['Cloth']),
};

/** Subclass values that are subject to proficiency checks */
const RESTRICTED_SUBCLASSES = new Set(['Cloth', 'Leather', 'Mail', 'Plate', 'Shield']);

/**
 * Check whether a loot item is equippable by the character's class.
 * Uses itemSubclass when available, falls back to slot name for shields.
 * Returns null if we can't determine (missing data), true/false otherwise.
 */
function isItemEquippable(
    characterClass: string | null | undefined,
    lootItemSubclass: string | null | undefined,
    slot: string | null | undefined,
): boolean | null {
    if (!characterClass) return null;

    // Determine the subclass to check: explicit field, or infer Shield from slot
    const subclass = lootItemSubclass
        ?? (slot === 'Shield' ? 'Shield' : null);

    if (!subclass) return null;
    if (!RESTRICTED_SUBCLASSES.has(subclass)) return null;

    const proficiencies = CLASS_EQUIP_PROFICIENCY[characterClass.toLowerCase()];
    if (!proficiencies) return null;
    return proficiencies.has(subclass);
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
    /** Armor subclass of the loot/reward item (e.g. "Plate", "Mail", "Leather", "Cloth", "Shield") */
    lootItemSubclass?: string | null;
    /** Item slot name — used to infer Shield when itemSubclass is missing */
    lootSlot?: string | null;
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
    lootSlot,
}: ItemComparisonProps) {
    const equippable = isItemEquippable(characterClass, lootItemSubclass, lootSlot);
    const displaySubclass = lootItemSubclass ?? (lootSlot === 'Shield' ? 'Shield' : null);

    // If the item is not equippable by this class, show that instead of comparison
    if (equippable === false) {
        return (
            <div className="item-comparison item-comparison--not-equippable">
                <span className="item-comparison__not-equippable">
                    Cannot equip {displaySubclass}
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

