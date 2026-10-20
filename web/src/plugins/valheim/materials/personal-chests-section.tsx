/** ROK-1853 — the viewer's personal chests; rendered only when `personal !== null` (ruling 2). */
import type { JSX } from 'react';
import type { ValheimMaterialsResponse } from '@raid-ledger/contract';
import type { ItemIconContext } from '../character/use-item-icons';
import { filterRows, groupTotals, sortRows, type MaterialSort, type MaterialsFilters } from './materials.helpers';
import { MaterialsTotalsTable } from './materials-totals-table';

interface PersonalProps {
    personal: NonNullable<ValheimMaterialsResponse['personal']>;
    filters: MaterialsFilters;
    sort: MaterialSort;
    onSort: (next: MaterialSort) => void;
    ctx: ItemIconContext;
}

export function PersonalChestsSection({ personal, filters, sort, onSort, ctx }: PersonalProps): JSX.Element {
    const rows = sortRows(filterRows(groupTotals(personal.totals, ctx.items, ctx.atlas), filters.search, filters.category), sort);
    const omitted = personal.omittedPrivate;
    return (
        <section aria-labelledby="valheim-personal-chests" className="space-y-2">
            <h2 id="valheim-personal-chests" className="text-base font-semibold text-foreground">Personal chests</h2>
            <p className="text-xs text-muted">
                {personal.chestCount} {personal.chestCount === 1 ? 'chest' : 'chests'}
                {omitted !== null && omitted > 0 && ` · ${omitted} personal ${omitted === 1 ? 'chest' : 'chests'} not scanned`}
            </p>
            <MaterialsTotalsTable rows={rows} sort={sort} onSort={onSort} ctx={ctx} caption="Personal chest totals" />
        </section>
    );
}
