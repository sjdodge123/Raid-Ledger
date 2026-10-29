/**
 * ROK-1853 — the hub Materials tab: scan age, toolbar, shared totals, the
 * viewer's personal chests, the warning banner, and the chest list with a
 * drill-down. Selecting a totals row narrows the chest list to the chests
 * holding that item (kept in the hash — ROK-1889); a new search clears the selection. Empty state while the server has sent no scan (`worldUid` null).
 * ROK-1859: the Base filter (also in the hash) narrows shared totals, the
 * personal section and the chest list to one base; a stale key means All bases.
 * ROK-2014: item rows carry the play-day trend chip of the active row set.
 */
import { useMemo, useState, type JSX } from 'react';
import type {
    ValheimMaterialsBase,
    ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import { useNow } from '../../../hooks/use-now';
import { useItemIconsFor } from '../character/use-item-icons';
import {
    useValheimContainers,
    useValheimMaterials,
} from '../hooks/use-valheim-materials';
import { ChestsSection } from './chests-section';
import {
    activeBase,
    personalFor,
    sharedTotalsFor,
} from './materials-bases.helpers';
import { useMaterialsBase, useMaterialsItem } from './materials-hash';
import { sharedTrendFor } from './materials-trend.helpers';
import {
    categoriesOf,
    DEFAULT_MATERIALS_FILTERS,
    filterRows,
    groupTotals,
    MATERIALS_EMPTY_COPY,
    scanAgeLabel,
    sortRows,
    warningLines,
    type MaterialSort,
    type MaterialsFilters,
} from './materials.helpers';
import { MaterialsToolbar } from './materials-toolbar';
import { MaterialsTotalsTable } from './materials-totals-table';
import { PersonalChestsSection } from './personal-chests-section';

const DEFAULT_SORT: MaterialSort = { key: 'total', dir: 'desc' };

function ScanLine({
    data,
    base,
}: {
    data: ValheimMaterialsResponse;
    /** ROK-1859: the selected base's chest count replaces the scan's. */
    base: ValheimMaterialsBase | null;
}): JSX.Element | null {
    // Ticks while the tab stays open: the shared QueryClient never refetches on focus (Codex r3).
    const now = useNow();
    if (data.capturedAt === null) return null;
    const count = base?.chestCount ?? data.shared.chestCount;
    return (
        <p
            className="text-xs text-muted"
            data-testid="valheim-materials-scan-age"
        >
            {scanAgeLabel(data.capturedAt, now)} · {count} shared{' '}
            {count === 1 ? 'chest' : 'chests'}
            {data.catalogFallback &&
                ' · Item names come from the newest catalogue, not this server’s game version'}
        </p>
    );
}

function WarningBanner({
    data,
}: {
    data: ValheimMaterialsResponse;
}): JSX.Element | null {
    const lines = warningLines(data.shared.warnings);
    if (lines.length === 0) return null;
    return (
        <div
            role="status"
            className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
        >
            {lines.map((l) => (
                <p key={l}>{l}</p>
            ))}
        </div>
    );
}

interface BodyProps {
    serverId: number;
    data: ValheimMaterialsResponse;
    filters: MaterialsFilters;
    setFilters: (f: MaterialsFilters) => void;
}

function MaterialsBody({
    serverId,
    data,
    filters,
    setFilters,
}: BodyProps): JSX.Element {
    const [sort, setSort] = useState<MaterialSort>(DEFAULT_SORT);
    // ROK-1889: the open item is in the hash, so Back from a Map link restores it.
    const [selected, setSelected] = useMaterialsItem();
    const [baseKey, setBase] = useMaterialsBase();
    const base = activeBase(data, baseKey);
    const bases = data.bases ?? [];
    const chests = useValheimContainers(
        serverId,
        filters.includeVehicles,
        selected,
    );
    const onFilters = (next: MaterialsFilters): void => {
        if (next.search !== filters.search) setSelected(null);
        setFilters(next);
    };
    const onSelect = (prefab: string): void =>
        setSelected(selected === prefab ? null : prefab);
    const items = useMemo(
        () => ({ ...chests.data?.items, ...data.items }),
        [chests.data?.items, data.items],
    );
    const ctx = useItemIconsFor({ serverId, items, atlas: data.atlas });
    const all = groupTotals(sharedTotalsFor(data, base), ctx.items, ctx.atlas);
    const personal =
        data.personal === null ? null : personalFor(data.personal, base);
    // The category also filters the personal section, so offer its categories too.
    const mine = groupTotals(personal?.totals ?? [], ctx.items, ctx.atlas);
    const rows = sortRows(
        filterRows(all, filters.search, filters.category),
        sort,
    );
    const holdingLabel =
        selected === null
            ? null
            : ([...all, ...mine].find((r) => r.prefab === selected)?.label ??
              selected);
    return (
        <div className="space-y-4">
            <ScanLine data={data} base={base} />
            <MaterialsToolbar
                filters={filters}
                categories={categoriesOf([...all, ...mine])}
                onChange={onFilters}
                bases={bases}
                base={base?.key ?? null}
                onBase={setBase}
            />
            <WarningBanner data={data} />
            <MaterialsTotalsTable
                rows={rows}
                sort={sort}
                onSort={setSort}
                ctx={ctx}
                caption="Shared chest totals"
                selected={selected}
                onSelect={onSelect}
                trend={sharedTrendFor(data, base)}
            />
            {personal !== null && (
                <PersonalChestsSection
                    personal={personal}
                    filters={filters}
                    sort={sort}
                    onSort={setSort}
                    ctx={ctx}
                    selected={selected}
                    onSelect={onSelect}
                />
            )}
            <ChestsSection
                serverId={serverId}
                includeVehicles={filters.includeVehicles}
                chests={chests}
                bases={bases}
                base={base}
                holdingLabel={holdingLabel}
                holding={selected}
                onClear={() => setSelected(null)}
                ctx={ctx}
            />
        </div>
    );
}

export function ValheimMaterialsTab({
    serverId,
}: {
    serverId: number;
}): JSX.Element {
    const [filters, setFilters] = useState<MaterialsFilters>(
        DEFAULT_MATERIALS_FILTERS,
    );
    const q = useValheimMaterials(serverId, filters.includeVehicles);
    if (q.isPending)
        return (
            <p className="py-12 text-center text-sm text-muted">
                Loading materials…
            </p>
        );
    if (q.isError)
        return (
            <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
            >
                Couldn’t load materials. Try again in a moment.
            </p>
        );
    if (q.data.worldUid === null)
        return (
            <div className="py-12 text-center">
                <p className="text-sm text-muted">{MATERIALS_EMPTY_COPY}</p>
            </div>
        );
    return (
        <MaterialsBody
            serverId={serverId}
            data={q.data}
            filters={filters}
            setFilters={setFilters}
        />
    );
}
