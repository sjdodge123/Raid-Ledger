/** ROK-1853 — Materials helpers: grouping, search, sort, labels. */
import { describe, it, expect } from 'vitest';
import {
    materialsCatalogue,
    materialsFixture,
} from '../../../test/mocks/valheim-materials-handlers';
import {
    categoriesOf,
    filterRows,
    formatCoords,
    formatQualities,
    groupTotals,
    nextSort,
    scanAgeLabel,
    sortRows,
    warningLines,
} from './materials.helpers';

const rows = groupTotals(
    materialsFixture().shared.totals,
    materialsCatalogue,
    null,
);

describe('materials helpers', () => {
    it('folds qualities into one row per prefab, named from the catalogue', () => {
        const sword = rows.find((r) => r.prefab === 'SwordIron');
        expect(sword).toMatchObject({
            label: 'Iron sword',
            category: 'Weapon',
            total: 4,
            chests: 1,
        });
        expect(sword?.qualities.map((q) => q.quality)).toEqual([1, 2]);
        expect(
            groupTotals(
                [{ prefab: 'Mystery', quality: 1, total: 2, chests: 1 }],
                {},
                null,
            )[0]?.label,
        ).toBe('Mystery');
    });

    it('searches name or prefab case-insensitively and narrows by category', () => {
        expect(filterRows(rows, 'iron', null).map((r) => r.prefab)).toEqual([
            'SwordIron',
        ]);
        expect(filterRows(rows, 'swordir', null).map((r) => r.prefab)).toEqual([
            'SwordIron',
        ]);
        expect(
            filterRows(rows, '', 'Material')
                .map((r) => r.prefab)
                .sort(),
        ).toEqual(['Stone', 'Wood']);
        expect(categoriesOf(rows)).toEqual(['Material', 'Weapon']);
    });

    it('sorts by total, name and chests, and flips direction on the same column', () => {
        expect(
            sortRows(rows, { key: 'total', dir: 'desc' }).map((r) => r.prefab),
        ).toEqual(['Wood', 'Stone', 'SwordIron']);
        expect(
            sortRows(rows, { key: 'name', dir: 'asc' }).map((r) => r.label),
        ).toEqual(['Iron sword', 'Stone', 'Wood']);
        expect(nextSort({ key: 'total', dir: 'desc' }, 'total')).toEqual({
            key: 'total',
            dir: 'asc',
        });
        expect(nextSort({ key: 'total', dir: 'desc' }, 'name')).toEqual({
            key: 'name',
            dir: 'asc',
        });
    });

    it('formats qualities, coordinates and the scan age', () => {
        expect(formatQualities([{ quality: 1, total: 1240, chests: 2 }])).toBe(
            '×1,240',
        );
        expect(
            formatQualities([
                { quality: 1, total: 1, chests: 1 },
                { quality: 2, total: 3, chests: 1 },
            ]),
        ).toBe('q1 ×1 · q2 ×3');
        expect(formatCoords(120.4, -340.2)).toBe('x 120, z −340');
        const now = Date.parse('2026-10-20T12:00:00Z');
        expect(scanAgeLabel('2026-10-20T11:53:00Z', now)).toBe(
            'Scanned 7 min ago',
        );
        expect(scanAgeLabel('2026-10-20T11:59:30Z', now)).toBe(
            'Scanned just now',
        );
        expect(scanAgeLabel('2026-10-18T12:00:00Z', now)).toBe(
            'Scanned 2 days ago',
        );
    });

    it('lists one warning line per non-zero count', () => {
        expect(
            warningLines({
                unreadable: 0,
                omittedEntries: 0,
                omittedShared: 0,
            }),
        ).toEqual([]);
        expect(
            warningLines({
                unreadable: 1,
                omittedEntries: 2,
                omittedShared: 3,
            }),
        ).toEqual([
            '1 chest could not be read',
            'Some chests had too many items to list',
            '3 chests were not scanned',
        ]);
    });
});
