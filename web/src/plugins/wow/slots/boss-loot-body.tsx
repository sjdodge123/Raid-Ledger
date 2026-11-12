/**
 * Loot table body rendered under an expanded boss row.
 * Rows render through the shared `ItemCompareRow` — the same row quest
 * rewards use (ROK-2186).
 */
import { useState } from 'react';
import type { BossLootDto, EquipmentItemDto } from '@raid-ledger/contract';
import { isUsableByClass } from './boss-loot-constants';
import { ItemCompareRow } from '../components/item-compare-row';

/** Props for BossLootBody */
export interface BossLootBodyProps {
    loot: BossLootDto[] | undefined;
    isLoading: boolean;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null | undefined;
    hasCharacter: boolean;
}

function LootFilterToggle({ filterUsable, onToggle }: { filterUsable: boolean; onToggle: () => void }) {
    return (
        <div className="boss-loot-filter">
            <button className={`boss-loot-filter__toggle ${filterUsable ? 'boss-loot-filter__toggle--active' : ''}`} onClick={onToggle}>
                {filterUsable ? 'Show all classes' : 'Show my class only'}
            </button>
        </div>
    );
}

/** Loot table rendered under an expanded boss row */
export function BossLootBody({
    loot, isLoading, wowheadVariant,
    equippedBySlot, characterClass, hasCharacter,
}: BossLootBodyProps) {
    const [filterUsable, setFilterUsable] = useState(false);

    if (isLoading) return <div className="boss-loot-body"><div className="boss-loot-body__loading">Loading loot&hellip;</div></div>;
    if (!loot || loot.length === 0) return <div className="boss-loot-body"><div className="boss-loot-body__empty">No loot data available</div></div>;

    const hasClassRestrictions = loot.some((item) => item.classRestrictions && item.classRestrictions.length > 0);
    const displayLoot = filterUsable ? loot.filter((item) => isUsableByClass(item, characterClass)) : loot;

    return (
        <div className="boss-loot-body">
            {hasCharacter && hasClassRestrictions && <LootFilterToggle filterUsable={filterUsable} onToggle={() => setFilterUsable((v) => !v)} />}
            <div className="quest-rewards">
                {displayLoot.map((item) => (
                    <LootItemRow key={item.id} item={item} usable={isUsableByClass(item, characterClass)}
                        filterUsable={filterUsable} wowheadVariant={wowheadVariant}
                        equippedBySlot={equippedBySlot} characterClass={characterClass} hasCharacter={hasCharacter} />
                ))}
            </div>
        </div>
    );
}

function LootItemMeta({ item }: { item: BossLootDto }) {
    if (!item.classRestrictions?.length && !item.dropRate) return null;
    return (
        <div className="boss-loot-item-meta">
            {item.classRestrictions && item.classRestrictions.length > 0 && (
                <span className="quest-badge-restriction quest-badge-class">{item.classRestrictions.join(', ')}</span>
            )}
            {item.dropRate && <span className="boss-loot-item-meta__drop-rate">{(parseFloat(item.dropRate) * 100).toFixed(0)}% drop</span>}
        </div>
    );
}

/** Single loot item row: the shared compare row plus the drop's metadata */
function LootItemRow({ item, usable, filterUsable, wowheadVariant, equippedBySlot, characterClass, hasCharacter }: {
    item: BossLootDto; usable: boolean; filterUsable: boolean;
    wowheadVariant: string; equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null | undefined; hasCharacter: boolean;
}) {
    return (
        <ItemCompareRow item={item} wowheadVariant={wowheadVariant} equippedBySlot={equippedBySlot}
            characterClass={characterClass} hasCharacter={hasCharacter}
            className={!usable && !filterUsable ? 'quest-card--dimmed' : undefined}>
            <LootItemMeta item={item} />
        </ItemCompareRow>
    );
}
