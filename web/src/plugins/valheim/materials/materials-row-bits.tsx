/**
 * ROK-1853 — the totals row pieces both layouts of `MaterialsTotalsTable`
 * share: the item icon box, the row's selection toggle and the chest count.
 * Extracted by ROK-2014 so the table stays under the 300-line limit.
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { ItemIcon } from '../character/item-icon';
import type { ItemIconContext } from '../character/use-item-icons';
import { resolveItem } from '../character/item-icon.helpers';
import {
    chestLowerBoundLabel,
    formatCount,
    isChestLowerBound,
    type MaterialRow,
} from './materials.helpers';

export function RowIcon({
    prefab,
    ctx,
}: {
    prefab: string;
    ctx: ItemIconContext;
}): JSX.Element {
    const resolved = resolveItem(prefab, ctx.items, ctx.atlas);
    return (
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-panel">
            <ItemIcon resolved={resolved} prefab={prefab} ctx={ctx} />
        </span>
    );
}

/** The row's toggle: name (+ category) on desktop, the whole row on phone. */
export function RowToggle({
    row,
    selected,
    onSelect,
    className,
    children,
}: {
    row: MaterialRow;
    selected: boolean;
    onSelect: (prefab: string) => void;
    className: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <Button
            variant="bare"
            aria-pressed={selected}
            title={`Show the chests holding ${row.label}`}
            onClick={() => onSelect(row.prefab)}
            className={`rounded-md text-left hover:bg-overlay ${className}`}
        >
            {children}
        </Button>
    );
}

/**
 * Phone/tablet row (ROK-1867): the Button label span is `inline-flex` and does
 * not stretch, so the icon + name + total sat centred; `[&>[data-button-label]]:w-full`
 * (the menu-item idiom) lets the name's `flex-1` push the total to the right.
 */
export const COMPACT_ROW_CLS =
    'flex min-h-11 w-full items-center justify-start gap-3 px-1 py-2 text-left [&>[data-button-label]]:w-full [&>[data-button-label]]:gap-3';

/** Exact for one quality; `≥ n` (+ the spelt-out bound) when qualities split. */
export function ChestCount({
    row,
    unit,
}: {
    row: MaterialRow;
    unit: boolean;
}): JSX.Element {
    const word = unit ? ` ${row.chests === 1 ? 'chest' : 'chests'}` : '';
    const count = `${formatCount(row.chests)}${word}`;
    if (!isChestLowerBound(row)) return <>{count}</>;
    const label = chestLowerBoundLabel(row.chests);
    return (
        <span title={label}>
            <span aria-hidden="true">≥ {count}</span>
            <span className="sr-only">{label}</span>
        </span>
    );
}
