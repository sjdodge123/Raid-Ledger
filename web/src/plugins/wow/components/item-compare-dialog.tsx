/**
 * ROK-2176 layout A: one popup for a boss-loot drop against the viewer's
 * equipped item(s), opened by tapping the loot card OR the equipped card.
 * ≥769px: shared `Modal` (max-w-2xl), loot | equipped side by side.
 * ≤768px: `BottomSheet`, "This drop" stacked over "Equipped (label)".
 * The loot column carries the per-line deltas; a side without stats shows a
 * muted "Stats not synced" panel (the iLvl delta still shows).
 */
import type { ReactNode } from 'react';
import type { BossLootDto } from '@raid-ledger/contract';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { itemStatsView } from '../lib/item-stat-diff';
import { NOTE_EXPANSION_UNSUPPORTED, NOTE_STATS_NOT_SYNCED, type LootComparison } from '../lib/loot-compare-model';
import { ItemDetailBody } from './item-detail-body';
import { LineDelta } from './item-detail-sections';

export interface ItemCompareDialogProps {
    loot: BossLootDto;
    comparison: LootComparison;
    gameVariant: string;
    onClose: () => void;
}

const TAG = 'text-[0.625rem] font-bold uppercase tracking-wider text-dim';

function StatsUnknown({ text }: { text: string }) {
    return <div className="mt-2 px-2.5 py-2 rounded-lg bg-panel text-muted text-xs" data-testid="stats-not-synced">{text}</div>;
}

function lootNote(loot: BossLootDto, comparison: LootComparison): string | null {
    if (comparison.note === NOTE_EXPANSION_UNSUPPORTED) return NOTE_EXPANSION_UNSUPPORTED;
    return itemStatsView(loot) ? null : NOTE_STATS_NOT_SYNCED;
}

function ilvlDelta(loot: BossLootDto, comparison: LootComparison) {
    const eq = comparison.shownItem;
    if (loot.itemLevel == null || !eq || eq.itemLevel <= 0) return undefined;
    return { key: 'ILVL', name: 'iLvl', value: loot.itemLevel - eq.itemLevel, unit: 'flat' as const };
}

function LootColumn({ loot, comparison, gameVariant, tag }: Omit<ItemCompareDialogProps, 'onClose'> & { tag: string }) {
    const note = lootNote(loot, comparison);
    return (
        <section data-testid="compare-loot-column" aria-label={tag}>
            <div className="flex items-center justify-between mb-2">
                <span className={TAG}>{tag}</span>
                <LineDelta delta={ilvlDelta(loot, comparison)} suffix=" iLvl" />
            </div>
            <ItemDetailBody item={loot} gameVariant={gameVariant} deltas={comparison.deltas} />
            {note && <StatsUnknown text={note} />}
        </section>
    );
}

function EquippedColumn({ comparison, gameVariant, tag }: { comparison: LootComparison; gameVariant: string; tag: string }) {
    const { items } = comparison.target;
    return (
        <section data-testid="compare-equipped-column" aria-label={tag}>
            <div className={`${TAG} mb-2`}>{tag}</div>
            {items.length === 0 && <div className="text-sm text-muted">Nothing equipped in this slot</div>}
            <div className="space-y-4">
                {items.map((item) => (
                    <div key={`${item.slot}-${item.itemId}`}>
                        <ItemDetailBody item={item} gameVariant={gameVariant} />
                        {!itemStatsView(item) && <StatsUnknown text={NOTE_STATS_NOT_SYNCED} />}
                    </div>
                ))}
            </div>
        </section>
    );
}

function dialogTitle(loot: BossLootDto): string {
    return `Compare: ${loot.tooltip?.slotLabel ?? loot.slot ?? loot.itemName}`;
}

function equippedTag(comparison: LootComparison, phone: boolean): string {
    const label = comparison.target.label;
    if (!phone) return label ? `Equipped — ${label}` : 'Equipped';
    return label ? `Equipped (${label})` : 'Equipped';
}

function Columns({ props, phone }: { props: ItemCompareDialogProps; phone: boolean }): ReactNode {
    const { loot, comparison, gameVariant } = props;
    const hasTarget = comparison.target.mode !== 'none';
    return (
        <div className={phone ? 'space-y-5 pb-2' : 'grid grid-cols-2 gap-6'} data-testid="item-compare-dialog" data-layout={phone ? 'stacked' : 'columns'}>
            <LootColumn loot={loot} comparison={comparison} gameVariant={gameVariant} tag={phone ? 'This drop' : 'Loot'} />
            {hasTarget && <EquippedColumn comparison={comparison} gameVariant={gameVariant} tag={equippedTag(comparison, phone)} />}
        </div>
    );
}

/** See file docstring. Mount it only while open (the row owns `open`). */
export function ItemCompareDialog(props: ItemCompareDialogProps) {
    const phone = useMediaQuery('(max-width: 768px)');
    const title = dialogTitle(props.loot);
    if (phone) {
        return (
            <BottomSheet isOpen onClose={props.onClose} title={title} maxHeight="85vh">
                <Columns props={props} phone />
            </BottomSheet>
        );
    }
    return (
        <Modal isOpen onClose={props.onClose} title={title} maxWidth="max-w-2xl">
            <Columns props={props} phone={false} />
        </Modal>
    );
}
