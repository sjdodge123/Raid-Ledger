/**
 * ROK-1899 — the crafting window's detail pane (spec §3.1.3, §3.2): the
 * accent title ("Wood arrow ×20", "Bronze axe — quality 2"), the meta line,
 * the "Needs" slots, the "Full breakdown" disclosure and the footer. In
 * UPGRADE the slots, star level and station follow the "Upgrade to quality"
 * select. The caller keys it by mode + row so the quality resets per pick.
 */
import type { JSX } from 'react';
import type { ValheimRecipeCatalogResponse, ValheimRecipeCost } from '@raid-ledger/contract';
import { CraftBreakdown, type BreakdownStockScope } from './craft-breakdown';
import { CraftDetailFooter } from './craft-detail-footer';
import { detailCost, detailTitle, useDetailQuality } from './craft-detail.helpers';
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
