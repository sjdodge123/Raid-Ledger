/**
 * ROK-1899 — the Planner's crafting window (spec §3.1–3.4, approved v2
 * mockup): station switcher (with the star badge), the station title and
 * the CRAFT / UPGRADE switch, then the search row (`SearchInput` + the
 * Filters funnel) over the recipe list on the left and the detail pane on
 * the right. Below `DESKTOP_MQ` the list goes full width and a row opens
 * the detail in a `BottomSheet`. The caller owns `filters` (they also set
 * the stock scope); stock totals are null while loading, on error or with no
 * scan, so rows stay neutral. On desktop, Escape on the list or the pane (or
 * the pane's "Back to your list") clears the selection and puts focus back on
 * the list; on phones closing the sheet hands back the list instead.
 */
import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
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
import { activePlannerFilters, CRAFT_NO_SCAN_COPY, DEFAULT_PLANNER_FILTERS, type PlannerFilters, type PlannerTarget } from './planner.helpers';
import { PlannerFilterControls } from './planner-filters';
import { spoilersStatusCopy } from './spoilers.helpers';
import { RecipeList } from './recipe-list';
import { StationSwitcher } from './station-switcher';
import { rowKey, useCraftingWindow, type CraftingWindow as WindowModel } from './use-crafting-window';
import type { StockState } from './ingredient-slots';
import type { PlannerNames } from './use-planner-names';

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
                <PlannerFilterControls filters={filters} categories={categories} hasPersonal={hasPersonal} discovery={catalog.discovery ?? 'no-character'} onChange={onFilters} />
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

/** ROK-1948 §5: the muted spoiler-protection status, or the fallback note when protection is off. */
function SpoilersLine({ status }: { status: CraftingWindowProps['catalog']['spoilers'] }): JSX.Element | null {
    const copy = spoilersStatusCopy(status);
    return copy === null ? null : <p className="text-xs text-muted" data-testid="valheim-planner-spoilers">{copy}</p>;
}

type KeyHandler = (e: KeyboardEvent<HTMLElement>) => void;

interface ListColumnProps { vm: WindowModel; props: CraftingWindowProps; stock: StockQuery; onSelect: (row: CraftRow) => void; onEscape: KeyHandler; listRef: RefObject<HTMLDivElement | null> }

function ListColumn({ vm, props, stock, onSelect, onEscape, listRef }: ListColumnProps): JSX.Element {
    return (
        <div className="space-y-2">
            <SearchRow vm={vm} props={props} />
            <SpoilersLine status={props.catalog.spoilers} />
            {vm.searching && <p role="status" className="text-xs text-muted">Matches from every station</p>}
            {/* Escape bubbling up from a row clears the selection (the rows are the focusable controls). */}
            <div ref={listRef} onKeyDown={onEscape}>
                <RecipeList label={listLabel(vm)} rows={vm.rows} selectedKey={vm.selectedKey} onSelect={onSelect} names={props.names}
                    showStation={vm.searching} busy={stock.isFetching} empty={<ListEmpty vm={vm} />} />
            </div>
        </div>
    );
}

const stockStateOf = (stock: StockQuery): StockState => {
    if (stock.isError) return 'error';
    return stock.data === undefined ? 'loading' : stock.data.stock;
};

function useWindow(props: CraftingWindowProps, desktop: boolean) {
    const { serverId, catalog, filters, onFilters, hasPersonal } = props;
    const personal = filters.includePersonal && hasPersonal;
    const stock = useValheimRecipeStock(serverId, personal, filters.includeVehicles);
    const totals = !stock.isError && stock.data?.stock === 'scan' ? stock.data.totals : null;
    const vm = useCraftingWindow({
        entries: catalog.entries, stations: catalog.stations, filters, onFilters, totals, stationName: props.names.stationName, discovery: catalog.discovery ?? 'no-character',
    });
    const [sheetOpen, setSheetOpen] = useState(false);
    const { select } = vm;
    // Only a phone pick opens the sheet: a desktop pick must not pop one if the viewport later narrows.
    const onSelect = useCallback((row: CraftRow) => {
        select(row);
        if (!desktop) setSheetOpen(true);
    }, [select, desktop]);
    const detail: Omit<CraftDetailProps, 'row'> = {
        serverId, catalog, mode: vm.mode, totals, stockState: stockStateOf(stock), names: props.names, stock: { personal, vehicles: filters.includeVehicles }, onAdd: props.onAdd, atCap: props.atCap,
    };
    return { stock, vm, sheetOpen, setSheetOpen, onSelect, detail };
}

/**
 * Desktop deselect: `onBack` clears the selection and focuses the list's tab
 * stop (the row last focused, else the first; the search box when nothing is
 * listed, so focus never drops to <body>); `onEscape` does the same for an
 * Escape nobody else handled while a row is selected.
 */
function useDeselect(vm: WindowModel, desktop: boolean): { listRef: RefObject<HTMLDivElement | null>; onBack: () => void; onEscape: KeyHandler } {
    const listRef = useRef<HTMLDivElement>(null);
    const { deselect, selected } = vm;
    const onBack = useCallback(() => {
        deselect();
        const list = listRef.current;
        const row = list?.querySelector<HTMLElement>('[data-ri][tabindex="0"]');
        (row ?? list?.parentElement?.querySelector<HTMLElement>('input[type="search"]'))?.focus();
    }, [deselect]);
    const onEscape = useCallback((e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== 'Escape' || e.defaultPrevented || !desktop || selected === null) return;
        e.preventDefault();
        onBack();
    }, [desktop, selected, onBack]);
    return { listRef, onBack, onEscape };
}

/** The crafting window; see the module doc. */
export function CraftingWindow(props: CraftingWindowProps): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const { stock, vm, sheetOpen, setSheetOpen, onSelect, detail } = useWindow(props, desktop);
    const { listRef, onBack, onEscape } = useDeselect(vm, desktop);
    const selected = vm.selected;
    const key = selected === null ? '' : `${vm.mode}:${rowKey(selected)}`;
    return (
        <section aria-label="Crafting window" className="space-y-4 rounded-lg border border-edge-strong bg-panel p-4">
            <WindowHeader vm={vm} names={props.names} />
            <StockStatus stock={stock} />
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(20rem,24rem)_1fr]">
                <ListColumn vm={vm} props={props} stock={stock} onSelect={onSelect} onEscape={onEscape} listRef={listRef} />
                <div className="min-w-0" onKeyDown={onEscape}>
                    {desktop && selected !== null ? <CraftDetail key={key} {...detail} row={selected} onBack={onBack} /> : props.idle}
                </div>
            </div>
            {!desktop && selected !== null && (
                <CraftDetailSheet key={key} {...detail} row={selected} isOpen={sheetOpen} onClose={() => setSheetOpen(false)} />
            )}
        </section>
    );
}
