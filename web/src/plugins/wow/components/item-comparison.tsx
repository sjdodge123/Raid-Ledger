import type { EquipmentItemDto } from '@raid-ledger/contract';
import { WowItemCard } from './wow-item-card';
import { getWowheadItemUrl, getWowheadDataSuffix } from '../lib/wowhead-urls';
import './item-comparison.css';


interface ItemComparisonProps {
    /** The reward item's level (may be null if unknown) */
    rewardItemLevel: number | null;
    /** The currently equipped item in the matching slot */
    equippedItem: EquipmentItemDto | undefined;
    /** WoW game variant for Wowhead URLs */
    gameVariant: string | null;
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
}: ItemComparisonProps) {
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

