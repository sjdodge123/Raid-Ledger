import { describe, expect, it } from 'vitest';
import type { ValheimInventory } from '@raid-ledger/contract';
import { inventoryRows, inventoryUsage } from './inventory-grid.helpers';

const item = {
    prefab: 'Resin',
    stack: 1,
    quality: 1,
    variant: 0,
    durability: null,
    maxDurability: null,
};

function grid(
    height: number,
    extraRows: ValheimInventory['grid']['extraRows'],
    items: ValheimInventory['items'] = [],
): ValheimInventory {
    return { grid: { width: 8, height, extraRows }, items };
}

describe('inventoryRows', () => {
    it('a vanilla 8×4 grid has four unlabelled rows of eight cells', () => {
        const rows = inventoryRows(grid(4, []));
        expect(rows).toHaveLength(4);
        expect(rows.every((r) => r.band === null && r.cells.length === 8)).toBe(
            true,
        );
    });
    it('places a slot at its x,y and leaves the rest empty', () => {
        const rows = inventoryRows(
            grid(4, [], [{ x: 3, y: 2, equipped: true, item }]),
        );
        expect(rows[2]?.cells[3]?.item.prefab).toBe('Resin');
        expect(rows[2]?.cells.filter((c) => c !== null)).toHaveLength(1);
    });
    it('EAQS rows get one "Equipment" band and one "Quick slots" band', () => {
        const rows = inventoryRows(
            grid(7, [
                { y: 4, purpose: 'equipment' },
                { y: 5, purpose: 'equipment' },
                { y: 6, purpose: 'quickslot' },
            ]),
        );
        expect(rows.map((r) => r.band)).toEqual([
            null,
            null,
            null,
            null,
            'Equipment',
            null,
            'Quick slots',
        ]);
    });
    it('"extended" and "other" share the "Extra" band', () => {
        const rows = inventoryRows(
            grid(6, [
                { y: 4, purpose: 'extended' },
                { y: 5, purpose: 'other' },
            ]),
        );
        expect(rows.map((r) => r.band)).toEqual([
            null,
            null,
            null,
            null,
            'Extra',
            null,
        ]);
    });
    it('inventoryUsage counts used of width × height', () => {
        expect(
            inventoryUsage(
                grid(4, [], [{ x: 0, y: 0, equipped: false, item }]),
            ),
        ).toEqual({ used: 1, total: 32 });
    });
});
