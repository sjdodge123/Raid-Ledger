/** ROK-1899 — the crafting window's view model: mode, station, search, selection, empty reasons. */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BY_HAND_KEY } from './crafting.helpers';
import { CRAFT_ENTRIES, CRAFT_STATIONS, CRAFT_TOTALS } from './crafting.test-fixture';
import { DEFAULT_PLANNER_FILTERS, processorLabel, type PlannerFilters } from './planner.helpers';
import { rowKey, useCraftingWindow } from './use-crafting-window';

function setup(filters: PlannerFilters = DEFAULT_PLANNER_FILTERS) {
    const onFilters = vi.fn();
    const hook = renderHook((p: { filters: PlannerFilters }) =>
        useCraftingWindow({ entries: CRAFT_ENTRIES, stations: CRAFT_STATIONS, filters: p.filters, onFilters, totals: CRAFT_TOTALS, stationName }),
        { initialProps: { filters } },
    );
    return { ...hook, onFilters };
}
const stationName = (p: string): string => CRAFT_STATIONS.find((s) => s.prefab === p)?.name ?? processorLabel(p) ?? p;
const names = (rows: { entry: { name: string } }[]): string[] => rows.map((r) => r.entry.name);

describe('useCraftingWindow', () => {
    it('opens on CRAFT at the first station, by name then By hand, rows ranked', () => {
        const { result } = setup();
        expect(result.current.mode).toBe('craft');
        expect(result.current.groups.map((g) => g.label)).toEqual(['Forge', 'Workbench', 'By hand']);
        expect(result.current.stationKey).toBe('forge');
        expect(names(result.current.rows)).toEqual(['Bronze', 'Bronze axe', 'Bronze nails']);
        expect(result.current.rows[0]?.afford).toEqual({ state: 'short', anyOneOf: false, missing: [{ prefab: 'Tin', more: 1 }] });
        expect(result.current.selectedGroup?.maxLevel).toBe(7);
    });

    it('selecting a station shows only its rows, affordable first', () => {
        const { result } = setup();
        act(() => result.current.selectStation('piece_workbench'));
        expect(names(result.current.rows)).toEqual(['Bronze buckler', 'Wood arrow']);
        act(() => result.current.selectStation(BY_HAND_KEY));
        expect(names(result.current.rows)).toEqual(['Club']);
        expect(result.current.rows[0]?.afford.state).toBe('can');
    });

});

describe('useCraftingWindow — search and selection', () => {
    it('search spans every station with no station selected; clearing restores the last one', () => {
        const { result } = setup();
        act(() => result.current.selectStation(BY_HAND_KEY));
        act(() => result.current.setSearch('bro'));
        expect(result.current.searching).toBe(true);
        expect(result.current.stationKey).toBeNull();
        expect(new Set(result.current.rows.map((r) => r.stationLabel))).toEqual(new Set(['Forge', 'Workbench']));
        act(() => result.current.setSearch(''));
        expect(result.current.stationKey).toBe(BY_HAND_KEY);
    });

    it('picking a row selects it and leaves the search text unchanged', () => {
        const { result } = setup();
        act(() => result.current.setSearch('bro'));
        const buckler = result.current.rows.find((r) => r.entry.name === 'Bronze buckler');
        if (buckler === undefined) throw new Error('no buckler row');
        act(() => result.current.select(buckler));
        expect(result.current.search).toBe('bro');
        expect(result.current.selectedKey).toBe(rowKey(buckler));
        expect(result.current.selected?.entry.name).toBe('Bronze buckler');
    });

    it('choosing a station while searching clears the search', () => {
        const { result } = setup();
        act(() => result.current.setSearch('bro'));
        act(() => result.current.selectStation('piece_workbench'));
        expect(result.current.search).toBe('');
        expect(result.current.stationKey).toBe('piece_workbench');
    });

});

describe('useCraftingWindow — modes and empty states', () => {
    it('UPGRADE lists upgradable entries, counts them and drops the CRAFT selection', () => {
        const { result } = setup();
        expect(result.current.upgradeCount).toBe(1);
        const first = result.current.rows[0];
        if (first === undefined) throw new Error('no row');
        act(() => result.current.select(first));
        act(() => result.current.setMode('upgrade'));
        expect(names(result.current.rows)).toEqual(['Bronze axe']);
        expect(result.current.rows[0]?.cost.stationLevel).toBe(2);
        expect(result.current.selected).toBeNull();
    });

    it('names why the list is empty and clears search and filters on request', () => {
        const { result, rerender, onFilters } = setup();
        act(() => result.current.setSearch('zzz'));
        expect(result.current.emptyReason).toBe('no-match');
        act(() => result.current.clearAll());
        expect(result.current.search).toBe('');
        expect(onFilters).toHaveBeenCalledWith(DEFAULT_PLANNER_FILTERS);
        expect(result.current.emptyReason).toBeNull();
        rerender({ filters: { ...DEFAULT_PLANNER_FILTERS, kind: 'piece' } });
        act(() => result.current.setMode('upgrade'));
        expect(result.current.emptyReason).toBe('no-upgrades');
    });
});

describe('useCraftingWindow — process-only items (ROK-1934)', () => {
    it('"cooked" and "meat" find Cooked meat at the Cooking station', () => {
        const { result } = setup();
        for (const text of ['cooked', 'meat']) {
            act(() => result.current.setSearch(text));
            const row = result.current.rows.find((r) => r.entry.prefab === 'CookedMeat');
            expect(row?.stationLabel, `"${text}" lists Cooked meat`).toBe('Cooking station');
            expect(row?.stationKey).toBe('process:piece_cookingstation');
        }
    });

    it('UPGRADE search never lists a process row', () => {
        const { result } = setup();
        act(() => result.current.setMode('upgrade'));
        act(() => result.current.setSearch('cooked'));
        expect(names(result.current.rows)).toEqual([]);
    });

    it('a process row picked from search stays selected once the search is cleared', () => {
        const { result } = setup();
        act(() => result.current.setSearch('copper'));
        const copper = result.current.rows.find((r) => r.entry.prefab === 'Copper');
        if (copper === undefined) throw new Error('no Copper row');
        act(() => result.current.select(copper));
        act(() => result.current.setSearch(''));
        expect(result.current.selected?.entry.prefab).toBe('Copper');
        expect(result.current.selected?.stationLabel).toBe('Smelter');
    });

    it('the switcher gains no processor station', () => {
        const { result } = setup();
        act(() => result.current.setSearch('copper'));
        expect(result.current.groups.map((g) => g.key).filter((k) => k.startsWith('process:'))).toEqual([]);
        expect(result.current.groups.map((g) => g.label)).toEqual(['Forge', 'Workbench', 'By hand']);
    });
});
