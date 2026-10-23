/**
 * ROK-1899 — the detail pane's "Needs" row (spec §3.1.3): a star slot (the
 * station and its required level), then one slot per direct ingredient with
 * the amount and "you have N". A short slot gets a dashed warning border,
 * "⚠ you have 3 · 7 short" in the warning tone and the full sentence as its
 * accessible name; with no chest scan the slots read "no scan". anyOneOf
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

export interface IngredientSlotsProps {
    cost: ValheimRecipeCost;
    totals: StockTotals | null;
    names: PlannerNames;
    /** The station's display name ("By hand" for a null station). */
    stationLabel: string;
}

const SLOT = 'flex w-24 flex-col items-center gap-1 rounded-md border bg-surface p-2 text-center text-xs';

const isShort = (line: SlotLine): boolean => (line.short ?? 0) > 0;

/** "you have 3 · 7 short", "you have 40", or "no scan". */
function haveText(line: SlotLine): string {
    if (line.have === null) return 'no scan';
    const have = `you have ${formatAmount(line.have)}`;
    return isShort(line) ? `${have} · ${formatAmount(line.short)} short` : have;
}

/** The slot's accessible name: "Tin: need 1, you have 0, 1 short". */
function slotLabel(name: string, line: SlotLine): string {
    const base = `${name}: need ${formatAmount(line.need)}`;
    if (line.have === null) return `${base}, no chest scan`;
    const have = `${base}, you have ${formatAmount(line.have)}`;
    return isShort(line) ? `${have}, ${formatAmount(line.short)} short` : have;
}

function Slot({ line, names }: { line: SlotLine; names: PlannerNames }): JSX.Element {
    const name = names.nameOf(line.prefab, 'item');
    const ctx = names.ctxFor(line.prefab, 'item');
    const resolved = { ...resolveItem(line.prefab, ctx.items, ctx.atlas), label: name };
    const short = isShort(line);
    return (
        <li
            aria-label={slotLabel(name, line)}
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
                {haveText(line)}
            </span>
        </li>
    );
}

function StarSlot({ stationLabel, level }: { stationLabel: string; level: number }): JSX.Element {
    return (
        <li aria-label={`${stationLabel}, level ${level}`} data-testid="valheim-craft-star-slot" className={`${SLOT} border-edge-subtle`}>
            <span aria-hidden="true" className="flex h-10 items-center text-2xl text-success">
                ★
            </span>
            <span className="font-medium text-foreground">{stationLabel}</span>
            <span className="text-muted">lvl {level}</span>
        </li>
    );
}

/** The star slot plus one slot per direct ingredient of `cost`. */
export function IngredientSlots({ cost, totals, names, stationLabel }: IngredientSlotsProps): JSX.Element {
    const lines = slotLines(cost, totals);
    const title = cost.anyOneOf ? 'Any one of' : 'Needs';
    return (
        <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
            <ul aria-label={title} className="flex flex-wrap gap-2">
                <StarSlot stationLabel={stationLabel} level={cost.stationLevel} />
                {lines.map((l) => (
                    <Slot key={l.prefab} line={l} names={names} />
                ))}
            </ul>
        </div>
    );
}
