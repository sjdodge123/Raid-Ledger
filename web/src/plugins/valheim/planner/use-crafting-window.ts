/**
 * ROK-1899 — the crafting window's view model (spec §3.1–3.4): CRAFT /
 * UPGRADE mode, the chosen station, the search text and the selected row.
 * Filters are owned by the caller (they also drive the stock query) and come
 * in controlled. Rows are grouped by `stationGroups`, narrowed by
 * `searchRows` across every station of the mode, and ranked by `sortRows`.
 */
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import type { ValheimRecipeCatalogEntry, ValheimRecipeStation } from '@raid-ledger/contract';
import {
    searchRows,
    sortRows,
    stationGroups,
    type CraftMode,
    type CraftRow,
    type RankedRow,
    type StationGroup,
    type StockTotals,
} from './crafting.helpers';
import { DEFAULT_PLANNER_FILTERS, type PlannerFilters } from './planner.helpers';

export interface CraftingWindowInput {
    entries: readonly ValheimRecipeCatalogEntry[];
    stations: readonly ValheimRecipeStation[];
    filters: PlannerFilters;
    onFilters: (next: PlannerFilters) => void;
    /** Stock totals; null while loading, on error, or with no scan (rows stay neutral). */
    totals: StockTotals | null;
}

/** Why the list is empty: nothing matches the search/filters, or nothing in this mode can be upgraded. */
export type CraftEmptyReason = 'no-match' | 'no-upgrades' | null;

export interface CraftingWindow {
    mode: CraftMode;
    setMode: (mode: CraftMode) => void;
    /** The switcher's stations for the current mode. */
    groups: StationGroup[];
    /** The switcher's value; null while searching (no station selected). */
    stationKey: string | null;
    /** The group behind `stationKey` (its `maxLevel` feeds the star badge). */
    selectedGroup: StationGroup | null;
    /** Choosing a station clears the search. */
    selectStation: (key: string) => void;
    search: string;
    setSearch: (text: string) => void;
    searching: boolean;
    /** The list, ranked can → short → unknown, then by name. */
    rows: RankedRow[];
    selectedKey: string | null;
    selected: RankedRow | null;
    /** Picking a row never writes into the search box. */
    select: (row: CraftRow) => void;
    /** Clear the selection, so the detail column shows its idle view again. */
    deselect: () => void;
    /** The UPGRADE count on the mode switch. */
    upgradeCount: number;
    emptyReason: CraftEmptyReason;
    /** "Clear search and filters". */
    clearAll: () => void;
}

/** Stable identity of a row: an item and a piece may share a prefab. */
export const rowKey = (row: CraftRow): string => `${row.entry.kind}:${row.entry.prefab}`;

function useGroups(input: CraftingWindowInput, mode: CraftMode) {
    const { entries, stations, filters } = input;
    const { kind, category } = filters;
    const craft = useMemo(() => stationGroups(entries, stations, 'craft', { kind, category }), [entries, stations, kind, category]);
    const upgrade = useMemo(() => stationGroups(entries, stations, 'upgrade', { kind, category }), [entries, stations, kind, category]);
    const upgradeCount = useMemo(() => upgrade.reduce((n, g) => n + g.rows.length, 0), [upgrade]);
    return { groups: mode === 'craft' ? craft : upgrade, upgradeCount };
}

type RankCache = WeakMap<CraftRow, RankedRow>;

function useSelection(rows: RankedRow[], groups: StationGroup[], totals: StockTotals | null, cache: RankCache) {
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const selected = useMemo((): RankedRow | null => {
        if (selectedKey === null) return null;
        const listed = rows.find((r) => rowKey(r) === selectedKey);
        if (listed !== undefined) return listed;
        // Selected in another station (search cleared, station switched): keep it for the detail pane.
        const other = groups.flatMap((g) => g.rows).find((r) => rowKey(r) === selectedKey);
        return other === undefined ? null : (sortRows([other], totals, cache)[0] ?? null);
    }, [rows, groups, totals, cache, selectedKey]);
    return { selectedKey: selected === null ? null : selectedKey, selected, setSelectedKey };
}

/** The crafting window's state and derived rows; see the module doc. */
export function useCraftingWindow(input: CraftingWindowInput): CraftingWindow {
    const [mode, setModeState] = useState<CraftMode>('craft');
    const [chosen, setChosen] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const { groups, upgradeCount } = useGroups(input, mode);
    // The list follows a deferred copy so typing stays responsive over ~900 rows.
    const query = useDeferredValue(search);
    const searching = query.trim() !== '';
    const current = groups.find((g) => g.key === chosen) ?? groups[0] ?? null;
    const cache = useMemo((): RankCache => new WeakMap(), [input.totals]);
    const rows = useMemo(
        () => sortRows(searching ? searchRows(groups, query) : (current?.rows ?? []), input.totals, cache),
        [searching, groups, query, current, input.totals, cache],
    );
    const sel = useSelection(rows, groups, input.totals, cache);
    const { setSelectedKey } = sel;
    const { onFilters } = input;
    const setMode = useCallback((m: CraftMode) => (setModeState(m), setSelectedKey(null)), [setSelectedKey]);
    const selectStation = useCallback((key: string) => (setChosen(key), setSearch('')), []);
    const select = useCallback((row: CraftRow) => setSelectedKey(rowKey(row)), [setSelectedKey]);
    const deselect = useCallback(() => setSelectedKey(null), [setSelectedKey]);
    const clearAll = useCallback(() => (setSearch(''), onFilters(DEFAULT_PLANNER_FILTERS)), [onFilters]);
    const emptyReason: CraftEmptyReason = rows.length > 0 ? null : !searching && mode === 'upgrade' ? 'no-upgrades' : 'no-match';
    return {
        mode, setMode, groups, stationKey: searching ? null : (current?.key ?? null), selectedGroup: searching ? null : current,
        selectStation, search, setSearch, searching, rows, selectedKey: sel.selectedKey, selected: sel.selected, select, deselect,
        upgradeCount, emptyReason, clearAll,
    };
}
