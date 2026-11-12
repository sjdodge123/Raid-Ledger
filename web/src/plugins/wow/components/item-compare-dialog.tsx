/**
 * ROK-2176 layout A: one popup for a boss-loot drop against the viewer's
 * equipped item(s), opened by tapping the loot card OR the equipped card.
 * ≥769px: shared `Modal` (max-w-2xl) holding `ItemCompareTable` — both item
 * heads over one aligned label | Loot | Equipped | Δ table (approved
 * prototype A). ≤768px: `BottomSheet`, "This drop" (with per-line deltas)
 * stacked over "Equipped (label)". A side without stats shows a muted
 * "Stats not synced" note (the iLvl delta still shows). While it is open no
 * Wowhead hover tooltip may sit above it (`useHideWowheadTooltips`).
 */
import type { BossLootDto } from '@raid-ledger/contract';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { itemStatsView } from '../lib/item-stat-diff';
import { NOTE_STATS_NOT_SYNCED, ilvlDelta, lootNote, type LootComparison } from '../lib/loot-compare-model';
import { useHideWowheadTooltips } from '../lib/use-hide-wowhead-tooltips';
import { ItemDetailBody } from './item-detail-body';
import { LineDelta } from './item-detail-sections';
import { COMPARE_TAG, ItemCompareTable, StatsUnknown, type ItemCompareTableProps } from './item-compare-table';

export interface ItemCompareDialogProps extends ItemCompareTableProps {
    onClose: () => void;
}

function LootColumn({ loot, comparison, gameVariant }: ItemCompareTableProps) {
    const note = lootNote(loot, comparison);
    return (
        <section data-testid="compare-loot-column" aria-label="This drop">
            <div className="flex items-center justify-between mb-2">
                <span className={COMPARE_TAG}>This drop</span>
                <LineDelta delta={ilvlDelta(loot, comparison)} suffix=" iLvl" />
            </div>
            <ItemDetailBody item={loot} gameVariant={gameVariant} deltas={comparison.deltas} />
            {note && <StatsUnknown text={note} side="loot" className="mt-2" />}
        </section>
    );
}

function EquippedColumn({ comparison, gameVariant }: { comparison: LootComparison; gameVariant: string }) {
    const { items, label } = comparison.target;
    const tag = label ? `Equipped (${label})` : 'Equipped';
    return (
        <section data-testid="compare-equipped-column" aria-label={tag}>
            <div className={`${COMPARE_TAG} mb-2`}>{tag}</div>
            {items.length === 0 && <div className="text-sm text-muted">Nothing equipped in this slot</div>}
            <div className="space-y-4">
                {items.map((item) => (
                    <div key={`${item.slot}-${item.itemId}`}>
                        <ItemDetailBody item={item} gameVariant={gameVariant} />
                        {!itemStatsView(item) && <StatsUnknown text={NOTE_STATS_NOT_SYNCED} side="equipped" className="mt-2" />}
                    </div>
                ))}
            </div>
        </section>
    );
}

/** Phone (prototype A phone): the drop with its deltas, then the equipped item(s). */
function Stacked({ loot, comparison, gameVariant }: ItemCompareTableProps) {
    return (
        <div className="space-y-5 pb-2" data-testid="item-compare-dialog" data-layout="stacked">
            <LootColumn loot={loot} comparison={comparison} gameVariant={gameVariant} />
            {comparison.target.mode !== 'none' && <EquippedColumn comparison={comparison} gameVariant={gameVariant} />}
        </div>
    );
}

function dialogTitle(loot: BossLootDto): string {
    return `Compare: ${loot.tooltip?.slotLabel ?? loot.slot ?? loot.itemName}`;
}

/** See file docstring. Mount it only while open (the row owns `open`). */
export function ItemCompareDialog({ onClose, ...body }: ItemCompareDialogProps) {
    const phone = useMediaQuery('(max-width: 768px)');
    useHideWowheadTooltips(true);
    const title = dialogTitle(body.loot);
    if (phone) {
        return (
            <BottomSheet isOpen onClose={onClose} title={title} maxHeight="85vh">
                <Stacked {...body} />
            </BottomSheet>
        );
    }
    return (
        <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-2xl">
            <ItemCompareTable {...body} />
        </Modal>
    );
}
