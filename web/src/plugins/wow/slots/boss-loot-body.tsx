/**
 * Loot table body rendered under an expanded boss row.
 * Uses the same WowItemCard + ItemComparison pattern as quest prep rewards.
 */
import { useState } from 'react';
import type { BossLootDto, EquipmentItemDto } from '@raid-ledger/contract';
import { WowItemCard } from '../components/wow-item-card';
import { ItemComparison } from '../components/item-comparison';
import { getWowheadItemUrlForExpansion, getWowheadDataSuffixForExpansion } from '../lib/wowhead-urls';
import { LOOT_TO_EQUIP_SLOT, isUsableByClass } from './boss-loot-constants';

/** Props for BossLootBody */
export interface BossLootBodyProps {
    loot: BossLootDto[] | undefined;
    isLoading: boolean;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null;
    hasCharacter: boolean;
}

/** Loot table rendered under an expanded boss row */
export function BossLootBody({
    loot, isLoading, wowheadVariant,
    equippedBySlot, characterClass, hasCharacter,
}: BossLootBodyProps) {
    const [filterUsable, setFilterUsable] = useState(false);

    if (isLoading) {
        return (
            <div className="boss-loot-body">
                <div className="boss-loot-body__loading">Loading loot&hellip;</div>
            </div>
        );
    }

    if (!loot || loot.length === 0) {
        return (
            <div className="boss-loot-body">
                <div className="boss-loot-body__empty">No loot data available</div>
            </div>
        );
    }

    const hasClassRestrictions = loot.some(
        (item) => item.classRestrictions && item.classRestrictions.length > 0,
    );

    const displayLoot = filterUsable
        ? loot.filter((item) => isUsableByClass(item, characterClass))
        : loot;

    return (
        <div className="boss-loot-body">
            {hasCharacter && hasClassRestrictions && (
                <div className="boss-loot-filter">
                    <button
                        className={`boss-loot-filter__toggle ${filterUsable ? 'boss-loot-filter__toggle--active' : ''}`}
                        onClick={() => setFilterUsable((v) => !v)}
                    >
                        {filterUsable ? 'Show all classes' : 'Show my class only'}
                    </button>
                </div>
            )}

            <div className="quest-rewards">
                {displayLoot.map((item) => (
                    <LootItemRow
                        key={item.id}
                        item={item}
                        usable={isUsableByClass(item, characterClass)}
                        filterUsable={filterUsable}
                        wowheadVariant={wowheadVariant}
                        equippedBySlot={equippedBySlot}
                        characterClass={characterClass}
                        hasCharacter={hasCharacter}
                    />
                ))}
            </div>
        </div>
    );
}

/** Single loot item row with comparison and metadata */
function LootItemRow({ item, usable, filterUsable, wowheadVariant, equippedBySlot, characterClass, hasCharacter }: {
    item: BossLootDto; usable: boolean; filterUsable: boolean;
    wowheadVariant: string; equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null; hasCharacter: boolean;
}) {
    const equipSlot = item.slot ? LOOT_TO_EQUIP_SLOT[item.slot] ?? item.slot : null;
    const equippedItem = equipSlot ? equippedBySlot.get(equipSlot) : undefined;

    return (
        <div
            className={`quest-reward-item-wrapper ${!usable && !filterUsable ? 'quest-card--dimmed' : ''}`}
        >
            <WowItemCard
                itemId={item.itemId} name={item.itemName} quality={item.quality}
                slot={item.slot} itemLevel={item.itemLevel} iconUrl={item.iconUrl}
                wowheadUrl={getWowheadItemUrlForExpansion(item.itemId, item.expansion)}
                wowheadData={`item=${item.itemId}&${getWowheadDataSuffixForExpansion(item.expansion)}`}
            />
            {equipSlot && hasCharacter && (
                <ItemComparison
                    rewardItemLevel={item.itemLevel} equippedItem={equippedItem}
                    gameVariant={wowheadVariant} characterClass={characterClass}
                    lootItemSubclass={item.itemSubclass} lootSlot={item.slot}
                />
            )}
            {(item.classRestrictions?.length || item.dropRate) && (
                <div className="boss-loot-item-meta">
                    {item.classRestrictions && item.classRestrictions.length > 0 && (
                        <span className="quest-badge-restriction quest-badge-class">
                            {item.classRestrictions.join(', ')}
                        </span>
                    )}
                    {item.dropRate && (
                        <span className="boss-loot-item-meta__drop-rate">
                            {(parseFloat(item.dropRate) * 100).toFixed(0)}% drop
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
