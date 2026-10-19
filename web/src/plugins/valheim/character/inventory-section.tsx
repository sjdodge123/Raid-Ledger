/**
 * ROK-1836 — the inventory grid (new pattern): `height × width` 44px cells,
 * labelled row bands for EAQS / extended rows, scrolling sideways inside its
 * card on a phone rather than shrinking the tap targets (Q10). The grid is ONE
 * tab stop with a roving tabindex (arrows, Home / End — `useRovingGrid`); a
 * band is a `rowgroup` named by its label, never a row of its own.
 */
import type { JSX } from 'react';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import type { ValheimCharacterSectionProps } from './character-section-slots';
import {
    inventoryRows,
    inventoryUsage,
    type InventoryRow,
    type InventorySlot,
} from './inventory-grid.helpers';
import { EmptyItemTile, ItemTile } from './item-tile';
import { useItemIcons, type ItemIconContext } from './use-item-icons';
import { useRovingGrid } from './use-roving-grid';

const SWIPE_HINT = 'Swipe the grid to see every column.';

type TabIndexFor = (r: number, c: number) => number;

interface BandGroup {
    band: string | null;
    rows: InventoryRow[];
}

/** Consecutive rows under one band label (the leading vanilla rows have none). */
function groupByBand(rows: InventoryRow[]): BandGroup[] {
    const groups: BandGroup[] = [];
    for (const row of rows) {
        const last = groups[groups.length - 1];
        if (last === undefined || row.band !== null)
            groups.push({ band: row.band, rows: [row] });
        else last.rows.push(row);
    }
    return groups;
}

function RowBand({ band }: { band: string }): JSX.Element {
    return (
        <div
            aria-hidden="true"
            data-testid="valheim-row-band"
            className="mt-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-dim after:h-px after:flex-1 after:bg-edge"
        >
            {band}
        </div>
    );
}

function Cell(props: {
    slot: InventorySlot | null;
    rc: string;
    tabIndex: number;
    ctx: ItemIconContext;
}): JSX.Element {
    const { slot, rc, tabIndex, ctx } = props;
    if (slot === null)
        return (
            <div
                role="gridcell"
                data-rc={rc}
                tabIndex={tabIndex}
                aria-label="Empty slot"
                className={`flex rounded-lg ${FOCUS_RING}`}
            >
                <EmptyItemTile />
            </div>
        );
    return (
        <div role="gridcell" className="flex">
            <ItemTile
                item={slot.item}
                ctx={ctx}
                equipped={slot.equipped}
                focusProps={{ tabIndex, 'data-rc': rc }}
            />
        </div>
    );
}

function GridRow(props: {
    row: InventoryRow;
    ctx: ItemIconContext;
    tabIndexFor: TabIndexFor;
}): JSX.Element {
    const { row, ctx, tabIndexFor } = props;
    return (
        <div role="row" data-row={row.y} className="flex gap-1">
            {row.cells.map((slot, x) => (
                <Cell
                    key={x}
                    slot={slot}
                    rc={`${row.y},${x}`}
                    tabIndex={tabIndexFor(row.y, x)}
                    ctx={ctx}
                />
            ))}
        </div>
    );
}

function Group(props: {
    group: BandGroup;
    ctx: ItemIconContext;
    tabIndexFor: TabIndexFor;
}): JSX.Element {
    const { group, ctx, tabIndexFor } = props;
    return (
        <div
            role="rowgroup"
            {...(group.band !== null ? { 'aria-label': group.band } : {})}
            className="grid gap-1"
        >
            {group.band !== null ? <RowBand band={group.band} /> : null}
            {group.rows.map((row) => (
                <GridRow
                    key={row.y}
                    row={row}
                    ctx={ctx}
                    tabIndexFor={tabIndexFor}
                />
            ))}
        </div>
    );
}

function InventoryGrid({
    character,
    ctx,
}: ValheimCharacterSectionProps & { ctx: ItemIconContext }): JSX.Element {
    const { width, height } = character.inventory.grid;
    const { tabIndexFor, gridProps } = useRovingGrid(height, width);
    const groups = groupByBand(inventoryRows(character.inventory));
    return (
        <div
            role="grid"
            aria-label="Inventory"
            className="grid w-max gap-1"
            {...gridProps}
        >
            {groups.map((g) => (
                <Group
                    key={g.rows[0]?.y ?? 0}
                    group={g}
                    ctx={ctx}
                    tabIndexFor={tabIndexFor}
                />
            ))}
        </div>
    );
}

export function InventorySection({
    character,
}: ValheimCharacterSectionProps): JSX.Element {
    const ctx = useItemIcons(character);
    const { used, total } = inventoryUsage(character.inventory);
    return (
        <>
            <p className="mb-3 text-sm tabular-nums text-muted">
                {used} of {total} slots used
            </p>
            <div
                tabIndex={0}
                aria-label="Inventory grid, scrolls sideways"
                className="-mx-1 overflow-x-auto px-1 pb-1"
            >
                <InventoryGrid character={character} ctx={ctx} />
            </div>
            <p className="mt-1.5 text-xs text-dim sm:hidden">{SWIPE_HINT}</p>
        </>
    );
}
