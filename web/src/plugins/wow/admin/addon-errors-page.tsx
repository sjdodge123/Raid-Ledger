/**
 * ROK-2099 — Admin → General → "Addon errors" (rulings 3 + 9): the BugGrabber
 * errors members' Companions upload, grouped by addon + message. A `blizzard`
 * plugin page on a core lazy route (design-system pattern note ROK-1836); the
 * settings layout limits it to admins, and it redirects while the plugin is off.
 */
import { useMemo, useState, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { usePluginStore } from '../../../stores/plugin-store';
import { ADDON_ERRORS_PLUGIN } from './addon-errors-route';
import {
    EMPTY_ADDON_ERROR_FILTERS, activeFilterCount, summaryLine, toApiFilters, type AddonErrorsFilterState,
} from './addon-errors-filters';
import { AddonErrorsTable } from './addon-errors-table';
import { AddonErrorsToolbar } from './addon-errors-toolbar';
import { useAddonErrorGroups, useAddonErrorsExport } from './use-addon-errors';

function PageHeader(): JSX.Element {
    return (
        <div>
            <h2 className="text-xl font-semibold text-foreground">Addon errors</h2>
            <p className="mt-1 text-sm text-muted">
                Errors from members&apos; WoW addons, sent by the Companion when they turn on “Share addon errors”.
                Names and Windows paths are removed before upload. Kept 90 days after last seen.
            </p>
        </div>
    );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }): JSX.Element | null {
    if (pages <= 1) return null;
    return (
        <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
            <span className="text-sm text-muted">Page {page} of {pages}</span>
            <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        </div>
    );
}

/** Search/filter/page/open-row state; any filter or search change returns to page 1 and closes the row. */
function useAddonErrorsPageState() {
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState<AddonErrorsFilterState>(EMPTY_ADDON_ERROR_FILTERS);
    const [page, setPage] = useState(1);
    const [expanded, setExpanded] = useState<string | null>(null);
    const reset = (): void => { setPage(1); setExpanded(null); };
    const apiFilters = useMemo(() => toApiFilters(filters, search), [filters, search]);
    return {
        query, setQuery, filters, page, expanded, apiFilters,
        filtered: activeFilterCount(filters) > 0 || search.trim() !== '',
        onSearch: (q: string) => { setSearch(q); reset(); },
        onFilters: (next: AddonErrorsFilterState) => { setFilters(next); reset(); },
        onPage: (p: number) => { setPage(p); setExpanded(null); },
        onToggle: (sig: string) => setExpanded((cur) => (cur === sig ? null : sig)),
    };
}

function AddonErrorsBody(): JSX.Element {
    const s = useAddonErrorsPageState();
    const groups = useAddonErrorGroups(s.apiFilters, s.page);
    const exporter = useAddonErrorsExport(s.apiFilters);
    const data = groups.data;
    const items = data?.items ?? [];
    return (
        <div className="space-y-4">
            <PageHeader />
            <AddonErrorsToolbar query={s.query} onQuery={s.setQuery} onSearch={s.onSearch} filters={s.filters} onFilters={s.onFilters}
                groups={items} exportBusy={exporter.busy} onExport={(f) => void exporter.run(f)} />
            {groups.isError && <p className="text-sm text-danger">Could not load addon errors.</p>}
            {data && data.total > 0 && <p className="text-sm text-muted">{summaryLine(data)}</p>}
            <AddonErrorsTable groups={items} isLoading={groups.isPending} filtered={s.filtered} expanded={s.expanded} onToggle={s.onToggle} />
            {data && <Pager page={s.page} pages={Math.ceil(data.total / data.pageSize)} onPage={s.onPage} />}
        </div>
    );
}

/** Waits for the plugin list, then shows the page — or leaves while `blizzard` is inactive. */
export function AddonErrorsPage(): JSX.Element | null {
    const settled = usePluginStore((st) => st.settled);
    const active = usePluginStore((st) => st.isPluginActive(ADDON_ERRORS_PLUGIN));
    if (!settled) return null;
    if (!active) return <Navigate to="/admin/settings/general" replace />;
    return <AddonErrorsBody />;
}
