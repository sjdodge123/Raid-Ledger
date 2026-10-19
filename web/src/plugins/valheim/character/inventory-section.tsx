/**
 * ROK-1836 — the inventory grid (new pattern): `height × width` 44px cells,
 * labelled row bands for EAQS / extended rows, scrolling sideways inside its
 * card on a phone rather than shrinking the tap targets (Q10).
 */
import type { JSX } from 'react';
import type { ValheimCharacterSectionProps } from './character-section-slots';
import { inventoryRows, inventoryUsage, type InventoryRow } from './inventory-grid.helpers';
import { EmptyItemTile, ItemTile } from './item-tile';
import { useItemIcons, type ItemIconContext } from './use-item-icons';

function GridRow({ row, ctx }: { row: InventoryRow; ctx: ItemIconContext }): JSX.Element {
    return (
        <>
            {row.band !== null ? (
                <div role="presentation" data-testid="valheim-row-band"
                    className="mt-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-dim after:h-px after:flex-1 after:bg-edge">
                    {row.band}
                </div>
            ) : null}
            <div role="row" data-row={row.y} className="flex gap-1">
                {row.cells.map((slot, x) => (
                    <div key={x} role="gridcell" className="flex">
                        {slot === null ? <EmptyItemTile /> : <ItemTile item={slot.item} ctx={ctx} equipped={slot.equipped} />}
                    </div>
                ))}
            </div>
        </>
    );
}

export function InventorySection({ character }: ValheimCharacterSectionProps): JSX.Element {
    const ctx = useItemIcons(character);
    const { used, total } = inventoryUsage(character.inventory);
    return (
        <>
            <p className="mb-3 text-sm tabular-nums text-muted">{used} of {total} slots used</p>
            <div tabIndex={0} aria-label="Inventory grid, scrolls sideways" className="-mx-1 overflow-x-auto px-1 pb-1">
                <div role="grid" aria-label="Inventory" className="grid w-max gap-1">
                    {inventoryRows(character.inventory).map((row) => <GridRow key={row.y} row={row} ctx={ctx} />)}
                </div>
            </div>
            <p className="mt-1.5 text-xs text-dim sm:hidden">Swipe the grid to see every column.</p>
        </>
    );
}
