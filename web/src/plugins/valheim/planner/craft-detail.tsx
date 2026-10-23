/**
 * ROK-1899 — the crafting window's detail pane (spec §3.1.3, §3.2): the
 * accent title ("Wood arrow ×20", "Bronze axe — quality 2"), the meta line,
 * the "Needs" slots, the "Full breakdown" disclosure and the footer. In
 * UPGRADE the slots, star level and station follow the "Upgrade to quality"
 * select. The caller keys it by mode + row so the quality resets per pick.
 */
import { useState, type JSX } from 'react';
import type { ValheimRecipeCatalogResponse, ValheimRecipeCost } from '@raid-ledger/contract';
import { CraftBreakdown, type BreakdownStockScope } from './craft-breakdown';
import { CraftDetailFooter } from './craft-detail-footer';
import { BY_HAND_LABEL, type CraftMode, type RankedRow, type StockTotals } from './crafting.helpers';
import { IngredientSlots } from './ingredient-slots';
import type { PlannerTarget } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';

export interface CraftDetailProps {
    serverId: number;
    catalog: ValheimRecipeCatalogResponse;
    row: RankedRow;
    mode: CraftMode;
    totals: StockTotals | null;
    names: PlannerNames;
    stock: BreakdownStockScope;
    onAdd: (target: PlannerTarget) => boolean;
    atCap: boolean;
}

/** The step the pane shows: CRAFT's recipe, or UPGRADE's step up to `quality`. */
export function detailCost(row: RankedRow, mode: CraftMode, quality: number): ValheimRecipeCost {
    if (mode === 'craft') return row.cost;
    return row.entry.upgrades.find((u) => u.quality === quality) ?? row.cost;
}

/** "Wood arrow ×20" in CRAFT, "Bronze axe — quality 2" in UPGRADE. */
export function detailTitle(row: RankedRow, mode: CraftMode, quality: number): string {
    if (mode === 'upgrade') return `${row.entry.name} — quality ${quality}`;
    const amount = row.entry.craft?.amount ?? 1;
    return amount > 1 ? `${row.entry.name} ×${amount}` : row.entry.name;
}

/** The pane's UPGRADE quality: the first upgrade step (q2) until the select moves it. */
export function useDetailQuality(row: RankedRow, mode: CraftMode): [number, (q: number) => void] {
    const [quality, setQuality] = useState(() => (mode === 'upgrade' ? (row.entry.upgrades[0]?.quality ?? 2) : 1));
    return [quality, setQuality];
}

const stationLabelOf = (cost: ValheimRecipeCost, names: PlannerNames): string =>
    cost.station === null ? BY_HAND_LABEL : names.stationName(cost.station);

/** Meta, slots and breakdown — shared by the desktop pane and the phone sheet. */
export function CraftDetailBody(props: CraftDetailProps & { quality: number; showTitle: boolean; breakdownOpen: boolean }): JSX.Element {
    const { row, mode, quality, totals, names, showTitle } = props;
    const cost = detailCost(row, mode, quality);
    const station = stationLabelOf(cost, names);
    const meta = [row.entry.category, `${station} lvl ${cost.stationLevel}`, row.entry.kind === 'item' ? `max quality ${row.entry.maxQuality}` : null];
    return (
        <div className="space-y-4">
            {showTitle && <h3 className="text-2xl font-semibold text-success">{detailTitle(row, mode, quality)}</h3>}
            <p className="text-sm text-muted" data-testid="valheim-craft-meta">
                {meta.filter((m) => m !== null).join(' · ')}
            </p>
            <IngredientSlots cost={cost} totals={totals} names={names} stationLabel={station} />
            <CraftBreakdown serverId={props.serverId} catalog={props.catalog} entry={row.entry} mode={mode} quality={quality}
                stock={props.stock} defaultOpen={props.breakdownOpen} />
        </div>
    );
}

/** The desktop detail column: body plus the footer. */
export function CraftDetail(props: CraftDetailProps): JSX.Element {
    const [quality, setQuality] = useDetailQuality(props.row, props.mode);
    return (
        <section aria-label="Recipe detail" className="space-y-4">
            <CraftDetailBody {...props} quality={quality} showTitle breakdownOpen />
            <CraftDetailFooter mode={props.mode} entry={props.row.entry} quality={quality} onQuality={setQuality} onAdd={props.onAdd} atCap={props.atCap} />
        </section>
    );
}
