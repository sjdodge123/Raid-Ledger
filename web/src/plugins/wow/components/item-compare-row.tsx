/**
 * ROK-2186: THE item row for boss loot and quest rewards — the item card,
 * the "Equipped:" block with per-stat delta chips (ROK-2176), and the
 * loot-vs-equipped compare popup. Both surfaces render this component so
 * their deltas, slot mapping and popup cannot drift (guarded by
 * `item-compare-row.guard.test.tsx`).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { BossLootDto, EquipmentItemDto } from '@raid-ledger/contract';
import { WowItemCard } from './wow-item-card';
import { ItemComparison } from './item-comparison';
import { ItemCompareDialog } from './item-compare-dialog';
import { lootComparison } from '../lib/loot-compare-model';
import { getWowheadItemUrlForExpansion, getWowheadDataSuffixForExpansion } from '../lib/wowhead-urls';

/** Wowhead link + tooltip data for the item card. */
export interface ItemRowLinks { url: string; data: string }

/** Props for ItemCompareRow */
export interface ItemCompareRowProps {
    /** The drop or reward, in loot shape (quest rewards via `questRewardAsLoot`). */
    item: BossLootDto;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null | undefined;
    /** Without a character there is nothing to compare against: no block, no popup. */
    hasCharacter: boolean;
    /** Overrides the expansion-derived Wowhead link — card AND popup (quest rewards link by game variant). */
    links?: ItemRowLinks | undefined;
    className?: string | undefined;
    /** Trailing per-surface metadata (e.g. boss loot's class badge + drop rate). */
    children?: ReactNode;
}

function expansionLinks(item: BossLootDto): ItemRowLinks {
    return {
        url: getWowheadItemUrlForExpansion(item.itemId, item.expansion),
        data: `item=${item.itemId}&${getWowheadDataSuffixForExpansion(item.expansion)}`,
    };
}

/** One item row: card + equipped comparison with stat chips + compare popup. */
export function ItemCompareRow({ item, wowheadVariant, equippedBySlot, characterClass, hasCharacter, links, className, children }: ItemCompareRowProps) {
    const [open, setOpen] = useState(false);
    const comparison = useMemo(() => lootComparison(item, equippedBySlot), [item, equippedBySlot]);
    const { url, data } = links ?? expansionLinks(item);
    const onOpen = hasCharacter ? () => setOpen(true) : undefined;
    return (
        <div className={`quest-reward-item-wrapper ${className ?? ''}`} data-testid="item-compare-row">
            <WowItemCard itemId={item.itemId} name={item.itemName} quality={item.quality} slot={item.slot}
                itemLevel={item.itemLevel} iconUrl={item.iconUrl} wowheadUrl={url} wowheadData={data} onOpen={onOpen} />
            {comparison.target.mode !== 'none' && hasCharacter && (
                <ItemComparison rewardItemLevel={item.itemLevel} equippedItem={comparison.shownItem}
                    gameVariant={wowheadVariant} characterClass={characterClass}
                    lootItemSubclass={item.itemSubclass} lootSlot={item.slot}
                    compareLabel={comparison.target.label} deltas={comparison.deltas}
                    statsNote={comparison.note} onOpen={onOpen} />
            )}
            {children}
            {open && <ItemCompareDialog loot={item} comparison={comparison} gameVariant={wowheadVariant} lootUrl={links?.url} onClose={() => setOpen(false)} />}
        </div>
    );
}
