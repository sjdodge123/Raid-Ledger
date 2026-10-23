/**
 * ROK-1899 — the Planner's crafting window (spec §3.1–3.4, approved v2
 * mockup): station switcher (with the star badge), the station title and
 * the CRAFT / UPGRADE switch, then the search row (`SearchInput` + the
 * Filters funnel) over the recipe list on the left and the detail pane on
 * the right. Below `DESKTOP_MQ` the list goes full width and a row opens
 * the detail in a `BottomSheet`. The caller owns `filters` (they also set
 * the stock scope); stock totals are null while loading, on error or with no
 * scan, so rows stay neutral.
 */
import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react';
import type { ValheimRecipeCatalogResponse } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { FilterEntry, FilterEntryTrigger } from '../../../components/ui/filter-entry';
import { SearchInput } from '../../../components/ui/search-input';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { MapError } from '../map/map-error';
import { useValheimRecipeStock } from '../hooks/use-valheim-recipes';
import { CraftDetail, type CraftDetailProps } from './craft-detail';
import { CraftDetailSheet } from './craft-detail-sheet';
import { CraftModeSwitch } from './craft-mode-switch';
import type { CraftRow } from './crafting.helpers';
import { activePlannerFilters, DEFAULT_PLANNER_FILTERS, type PlannerFilters, type PlannerTarget } from './planner.helpers';
import { PlannerFilterControls } from './planner-filters';
import { RecipeList } from './recipe-list';
import { StationSwitcher } from './station-switcher';
import { rowKey, useCraftingWindow, type CraftingWindow as WindowModel } from './use-crafting-window';
import type { PlannerNames } from './use-planner-names';

export const CRAFT_NO_SCAN_COPY = 'No chests scanned yet — every recipe is shown. Scan a chest in game to see what you can craft.';

export interface CraftingWindowProps {
    serverId: number;
    catalog: ValheimRecipeCatalogResponse;
    filters: PlannerFilters;
    onFilters: (next: PlannerFilters) => void;
    hasPersonal: boolean;
    names: PlannerNames;
    onAdd: (target: PlannerTarget) => boolean;
    atCap: boolean;
    /** The detail column (and, on phones, the space under the list) while nothing is selected. */
    idle: ReactNode;
}

type StockQuery = ReturnType<typeof useValheimRecipeStock>;

function WindowHeader({ vm, names }: { vm: WindowModel; names: PlannerNames }): JSX.Element {
    return (
        <div className="space-y-3">
            <StationSwitcher groups={vm.groups} value={vm.stationKey} onChange={vm.selectStation} names={names} />
            <div className="flex flex-col items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted" data-testid="valheim-craft-station-title">
                    {vm.searching ? 'Every station' : (vm.selectedGroup?.label ?? '')}
                </h3>
                <CraftModeSwitch value={vm.mode} onChange={vm.setMode} upgradeCount={vm.upgradeCount} />
            </div>
        </div>
    );
}

function SearchRow({ vm, props }: { vm: WindowModel; props: CraftingWindowProps }): JSX.Element {
    const { filters, onFilters, hasPersonal, catalog } = props;
    const [isOpen, setOpen] = useState(false);
    const categories = useMemo(() => [...new Set(catalog.entries.map((e) => e.category))].sort(), [catalog.entries]);
    const active = activePlannerFilters(filters);
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <SearchInput label="Search an item or piece" placeholder="Search an item or piece" value={vm.search} onChange={vm.setSearch} />
                </div>
                <FilterEntryTrigger activeCount={active} isOpen={isOpen} onOpenChange={setOpen} />
            </div>
            <FilterEntry activeCount={active} isOpen={isOpen} onOpenChange={setOpen} onClearAll={() => onFilters(DEFAULT_PLANNER_FILTERS)}>
                <PlannerFilterControls filters={filters} categories={categories} hasPersonal={hasPersonal} onChange={onFilters} />
            </FilterEntry>
        </div>
    );
}

function StockStatus({ stock }: { stock: StockQuery }): JSX.Element | null {
    if (stock.isError) return <MapError text="Couldn’t check your chests." onRetry={() => void stock.refetch()} />;
    if (stock.data?.stock === 'none') return <p role="status" className="text-sm text-muted">{CRAFT_NO_SCAN_COPY}</p>;
    return null;
}

function ListEmpty({ vm }: { vm: WindowModel }): JSX.Element {
    if (vm.emptyReason === 'no-upgrades') return <p className="text-sm text-muted">Nothing here can be upgraded.</p>;
    return (
        <div className="space-y-2">
            <p className="text-sm text-muted">No recipes match.</p>
            <Button variant="ghost" size="sm" onClick={vm.clearAll}>
                Clear search and filters
            </Button>
        </div>
    );
}

const listLabel = (vm: WindowModel): string => {
    if (vm.searching) return 'Matches from every station';
    return `${vm.selectedGroup?.label ?? 'Station'} ${vm.mode === 'craft' ? 'recipes' : 'upgrades'}`;
};

function ListColumn({ vm, props, stock, onSelect }: { vm: WindowModel; props: CraftingWindowProps; stock: StockQuery; onSelect: (row: CraftRow) => void }): JSX.Element {
    return (
        <div className="space-y-2">
            <SearchRow vm={vm} props={props} />
            {vm.searching && <p role="status" className="text-xs text-muted">Matches from every station</p>}
            <RecipeList label={listLabel(vm)} rows={vm.rows} selectedKey={vm.selectedKey} onSelect={onSelect} names={props.names}
                showStation={vm.searching} busy={stock.isFetching} empty={<ListEmpty vm={vm} />} />
        </div>
    );
}

function useWindow(props: CraftingWindowProps) {
    const { serverId, catalog, filters, onFilters, hasPersonal } = props;
    const personal = filters.includePersonal && hasPersonal;
    const stock = useValheimRecipeStock(serverId, personal, filters.includeVehicles);
    const totals = !stock.isError && stock.data?.stock === 'scan' ? stock.data.totals : null;
    const vm = useCraftingWindow({ entries: catalog.entries, stations: catalog.stations, filters, onFilters, totals });
    const [sheetOpen, setSheetOpen] = useState(false);
    const { select } = vm;
    const onSelect = useCallback((row: CraftRow) => (select(row), setSheetOpen(true)), [select]);
    const detail: Omit<CraftDetailProps, 'row'> = {
        serverId, catalog, mode: vm.mode, totals, names: props.names, stock: { personal, vehicles: filters.includeVehicles }, onAdd: props.onAdd, atCap: props.atCap,
    };
    return { stock, vm, sheetOpen, setSheetOpen, onSelect, detail };
}

/** The crafting window; see the module doc. */
export function CraftingWindow(props: CraftingWindowProps): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const { stock, vm, sheetOpen, setSheetOpen, onSelect, detail } = useWindow(props);
    const selected = vm.selected;
    const key = selected === null ? '' : `${vm.mode}:${rowKey(selected)}`;
    return (
        <section aria-label="Crafting window" className="space-y-4 rounded-lg border border-edge-strong bg-panel p-4">
            <WindowHeader vm={vm} names={props.names} />
            <StockStatus stock={stock} />
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(20rem,24rem)_1fr]">
                <ListColumn vm={vm} props={props} stock={stock} onSelect={onSelect} />
                <div className="min-w-0">{desktop && selected !== null ? <CraftDetail key={key} {...detail} row={selected} /> : props.idle}</div>
            </div>
            {!desktop && selected !== null && (
                <CraftDetailSheet key={key} {...detail} row={selected} isOpen={sheetOpen} onClose={() => setSheetOpen(false)} />
            )}
        </section>
    );
}
