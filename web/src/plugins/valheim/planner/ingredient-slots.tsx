/**
 * ROK-1899 — the detail pane's "Needs" row (spec §3.1.3): a star slot (the
 * station and its required level), then one slot per direct ingredient with
 * the amount and "you have N". A short slot gets a dashed warning border,
 * "⚠ you have 3 · 7 short" in the warning tone and the full sentence as its
 * accessible name; with no chest scan the slots read "no scan" ("checking…"
 * while stock loads, "unavailable" on a stock error). anyOneOf
 * steps title the row "Any one of". Ingredients without a catalogue row fall
 * back to the prefab id and no icon (via `PlannerNames`).
 */
import type { JSX } from 'react';
import type { ValheimRecipeCost } from '@raid-ledger/contract';
import { ItemIcon } from '../character/item-icon';
import { resolveItem } from '../character/item-icon.helpers';
import { slotLines, type SlotLine, type StockTotals } from './crafting.helpers';
import { formatAmount } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';

/** Where the stock totals stand: loading, failed, no scan, or a scan. */
export type StockState = 'loading' | 'error' | 'none' | 'scan';

export interface IngredientSlotsProps {
    cost: ValheimRecipeCost;
    totals: StockTotals | null;
    stockState: StockState;
    names: PlannerNames;
    /** The station's display name ("By hand" for a null station). */
    stationLabel: string;
}

const SLOT = 'flex w-24 flex-col items-center gap-1 rounded-md border bg-surface p-2 text-center text-xs';

const isShort = (line: SlotLine): boolean => (line.short ?? 0) > 0;

/** Slot text and accessible-name tail when there is no count to show. */
const NO_COUNT: Record<StockState, readonly [text: string, label: string]> = {
    loading: ['checking…', 'checking your chests'],
    error: ['unavailable', 'chest count unavailable'],
    none: ['no scan', 'no chest scan'],
    scan: ['no scan', 'no chest scan'],
};

/** "you have 3 · 7 short", "you have 40", or the no-count text. */
function haveText(line: SlotLine, state: StockState): string {
    if (line.have === null) return NO_COUNT[state][0];
    const have = `you have ${formatAmount(line.have)}`;
    return isShort(line) ? `${have} · ${formatAmount(line.short)} short` : have;
}

/** The slot's accessible name: "Tin: need 1, you have 0, 1 short". */
function slotLabel(name: string, line: SlotLine, state: StockState): string {
    const base = `${name}: need ${formatAmount(line.need)}`;
    if (line.have === null) return `${base}, ${NO_COUNT[state][1]}`;
    const have = `${base}, you have ${formatAmount(line.have)}`;
    return isShort(line) ? `${have}, ${formatAmount(line.short)} short` : have;
}

function Slot({ line, names, state }: { line: SlotLine; names: PlannerNames; state: StockState }): JSX.Element {
    const name = names.nameOf(line.prefab, 'item');
    const ctx = names.ctxFor(line.prefab, 'item');
    const resolved = { ...resolveItem(line.prefab, ctx.items, ctx.atlas), label: name };
    const short = isShort(line);
    return (
        <li
            aria-label={slotLabel(name, line, state)}
            data-testid="valheim-craft-slot"
            data-prefab={line.prefab}
            data-short={short ? 'true' : undefined}
            className={`${SLOT} ${short ? 'border-dashed border-warning' : 'border-edge-subtle'}`}
        >
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center overflow-hidden [&>*]:scale-125">
                <ItemIcon resolved={resolved} prefab={line.prefab} ctx={ctx} />
            </span>
            <span className="font-medium text-foreground">{name}</span>
            <span className="font-mono text-muted">×{formatAmount(line.need)}</span>
            <span className={short ? 'text-warning' : 'text-muted'}>
                {short && <span aria-hidden="true">⚠ </span>}
                {haveText(line, state)}
            </span>
        </li>
    );
}

function StarSlot({ stationLabel, level, upgrader }: { stationLabel: string; level: number; upgrader: boolean }): JSX.Element {
    // A processor (level 0) has no level to show (ROK-1934); ROK-1861 D8 names an upgrade station.
    const named = upgrader ? `${stationLabel}, upgrade station` : stationLabel;
    return (
        <li aria-label={level === 0 ? named : `${named}, level ${level}`} data-testid="valheim-craft-star-slot" className={`${SLOT} border-edge-subtle`}>
            <span aria-hidden="true" className="flex h-10 items-center text-2xl text-success">
                ★
            </span>
            <span className="font-medium text-foreground">{stationLabel}</span>
            {upgrader && <span className="text-muted">Upgrade station</span>}
            {level > 0 && <span className="text-muted">lvl {level}</span>}
        </li>
    );
}

/** The star slot plus one slot per direct ingredient of `cost`. */
export function IngredientSlots({ cost, totals, stockState, names, stationLabel }: IngredientSlotsProps): JSX.Element {
    const lines = slotLines(cost, totals);
    const title = cost.anyOneOf ? 'Any one of' : 'Needs';
    return (
        <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
            <ul aria-label={title} className="flex flex-wrap gap-2">
                <StarSlot stationLabel={stationLabel} level={cost.stationLevel} upgrader={'upgraderStation' in cost && cost.upgraderStation === true} />
                {lines.map((l) => (
                    <Slot key={l.prefab} line={l} names={names} state={stockState} />
                ))}
            </ul>
        </div>
    );
}
