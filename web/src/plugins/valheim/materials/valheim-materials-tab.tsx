/**
 * ROK-1853 — the hub Materials tab: scan age, toolbar, shared totals, the
 * viewer's personal chests, the warning banner, and the chest list with a
 * drill-down. Empty state while the server has sent no scan (`worldUid` null).
 */
import { useMemo, useState, type JSX } from 'react';
import type { ValheimContainerSummary, ValheimMaterialsResponse } from '@raid-ledger/contract';
import { useItemIconsFor, type ItemIconContext } from '../character/use-item-icons';
import { useValheimContainers, useValheimMaterials } from '../hooks/use-valheim-materials';
import { ChestDetail } from './chest-detail';
import { ChestList } from './chest-list';
import {
    categoriesOf, DEFAULT_MATERIALS_FILTERS, filterRows, groupTotals, MATERIALS_EMPTY_COPY, scanAgeLabel, sortRows,
    warningLines, type MaterialSort, type MaterialsFilters,
} from './materials.helpers';
import { MaterialsToolbar } from './materials-toolbar';
import { MaterialsTotalsTable } from './materials-totals-table';
import { PersonalChestsSection } from './personal-chests-section';

const DEFAULT_SORT: MaterialSort = { key: 'total', dir: 'desc' };

function ScanLine({ data }: { data: ValheimMaterialsResponse }): JSX.Element | null {
    // Read once per mount: the tab remounts on navigation and refetches on focus.
    const [now] = useState(() => Date.now());
    if (data.capturedAt === null) return null;
    return (
        <p className="text-xs text-muted" data-testid="valheim-materials-scan-age">
            {scanAgeLabel(data.capturedAt, now)} · {data.shared.chestCount} shared {data.shared.chestCount === 1 ? 'chest' : 'chests'}
            {data.catalogFallback && ' · Item names come from the newest catalogue, not this server’s game version'}
        </p>
    );
}

function WarningBanner({ data }: { data: ValheimMaterialsResponse }): JSX.Element | null {
    const lines = warningLines(data.shared.warnings);
    if (lines.length === 0) return null;
    return (
        <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            {lines.map((l) => <p key={l}>{l}</p>)}
        </div>
    );
}

function ChestsSection({ serverId, filters, containers, ctx }: { serverId: number; filters: MaterialsFilters; containers: readonly ValheimContainerSummary[]; ctx: ItemIconContext }): JSX.Element {
    const [open, setOpen] = useState<ValheimContainerSummary | null>(null);
    return (
        <section aria-labelledby="valheim-chests" className="space-y-2">
            <h2 id="valheim-chests" className="text-base font-semibold text-foreground">Chests</h2>
            <ChestList containers={containers} ctx={ctx} onOpen={setOpen} />
            <ChestDetail serverId={serverId} includeVehicles={filters.includeVehicles} chest={open} ctx={ctx} onClose={() => setOpen(null)} />
        </section>
    );
}

interface BodyProps {
    serverId: number;
    data: ValheimMaterialsResponse;
    filters: MaterialsFilters;
    setFilters: (f: MaterialsFilters) => void;
}

function MaterialsBody({ serverId, data, filters, setFilters }: BodyProps): JSX.Element {
    const [sort, setSort] = useState<MaterialSort>(DEFAULT_SORT);
    const chests = useValheimContainers(serverId, filters.includeVehicles);
    const items = useMemo(() => ({ ...chests.data?.items, ...data.items }), [chests.data?.items, data.items]);
    const ctx = useItemIconsFor({ serverId, items, atlas: data.atlas });
    const all = groupTotals(data.shared.totals, ctx.items, ctx.atlas);
    const rows = sortRows(filterRows(all, filters.search, filters.category), sort);
    return (
        <div className="space-y-4">
            <ScanLine data={data} />
            <MaterialsToolbar filters={filters} categories={categoriesOf(all)} onChange={setFilters} />
            <WarningBanner data={data} />
            <MaterialsTotalsTable rows={rows} sort={sort} onSort={setSort} ctx={ctx} caption="Shared chest totals" />
            {data.personal !== null && <PersonalChestsSection personal={data.personal} filters={filters} sort={sort} onSort={setSort} ctx={ctx} />}
            <ChestsSection serverId={serverId} filters={filters} containers={chests.data?.containers ?? []} ctx={ctx} />
        </div>
    );
}

export function ValheimMaterialsTab({ serverId }: { serverId: number }): JSX.Element {
    const [filters, setFilters] = useState<MaterialsFilters>(DEFAULT_MATERIALS_FILTERS);
    const q = useValheimMaterials(serverId, filters.includeVehicles);
    if (q.isPending) return <p className="py-12 text-center text-sm text-muted">Loading materials…</p>;
    if (q.isError)
        return <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">Couldn’t load materials. Try again in a moment.</p>;
    if (q.data.worldUid === null)
        return <div className="py-12 text-center"><p className="text-sm text-muted">{MATERIALS_EMPTY_COPY}</p></div>;
    return <MaterialsBody serverId={serverId} data={q.data} filters={filters} setFilters={setFilters} />;
}
