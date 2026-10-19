/**
 * ROK-1836 — lays the inventory grid out as rows. Vanilla rows (0–3) carry no
 * band; an EAQS / extended row starts a labelled band when its purpose differs
 * from the row above. Geometry is always `height × width` cells, item or not.
 */
import type { ValheimInventory } from '@raid-ledger/contract';

export type InventorySlot = ValheimInventory['items'][number];
type RowPurpose = ValheimInventory['grid']['extraRows'][number]['purpose'];

export const ROW_BAND_LABEL: Readonly<Record<RowPurpose, string>> = {
    equipment: 'Equipment',
    quickslot: 'Quick slots',
    extended: 'Extra',
    other: 'Extra',
};

export interface InventoryRow {
    y: number;
    /** Set on the first row of a labelled band. */
    band: string | null;
    cells: (InventorySlot | null)[];
}

function bandFor(
    purposeByRow: Map<number, RowPurpose>,
    y: number,
): string | null {
    const purpose = purposeByRow.get(y);
    if (purpose === undefined) return null;
    const above = purposeByRow.get(y - 1);
    if (
        above !== undefined &&
        ROW_BAND_LABEL[above] === ROW_BAND_LABEL[purpose]
    )
        return null;
    return ROW_BAND_LABEL[purpose];
}

export function inventoryRows(inventory: ValheimInventory): InventoryRow[] {
    const { width, height, extraRows } = inventory.grid;
    const bySlot = new Map(
        inventory.items.map((s) => [`${s.x},${s.y}`, s] as const),
    );
    const purposeByRow = new Map(
        extraRows.map((r) => [r.y, r.purpose] as const),
    );
    return Array.from({ length: height }, (_, y) => ({
        y,
        band: bandFor(purposeByRow, y),
        cells: Array.from(
            { length: width },
            (_, x) => bySlot.get(`${x},${y}`) ?? null,
        ),
    }));
}

/** "used/total" for the section count. */
export function inventoryUsage(inventory: ValheimInventory): {
    used: number;
    total: number;
} {
    return {
        used: inventory.items.length,
        total: inventory.grid.width * inventory.grid.height,
    };
}
