/**
 * ROK-2099 — the Addon errors toolbar: `SearchInput`, the §4.1 funnel
 * (`filter-entry.tsx`: toolbar trigger + inline panel at 1024px and up, the
 * Filters FAB + `BottomSheet` below) with Addon / Member / Last seen, and the
 * JSON / CSV export of whatever the filters select.
 */
import { useState, type JSX } from 'react';
import type { AddonErrorGroupDto, AddonErrorsExportFormat } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { FilterEntry, FilterEntryTrigger } from '../../../components/ui/filter-entry';
import { SearchInput } from '../../../components/ui/search-input';
import { Select } from '../../../components/ui/select';
import {
    ADDON_ERRORS_QUERY_MAX, EMPTY_ADDON_ERROR_FILTERS, LAST_SEEN_OPTIONS, activeFilterCount, addonOptions, memberOptions,
    type AddonErrorsFilterState, type FilterOption, type LastSeenWindow,
} from './addon-errors-filters';

export interface AddonErrorsToolbarProps {
    query: string;
    onQuery: (query: string) => void;
    /** Debounced search (fires the request). */
    onSearch: (query: string) => void;
    filters: AddonErrorsFilterState;
    onFilters: (next: AddonErrorsFilterState) => void;
    /** Loaded groups — the source of the Addon and Member options. */
    groups: readonly AddonErrorGroupDto[];
    exportBusy: AddonErrorsExportFormat | null;
    onExport: (format: AddonErrorsExportFormat) => void;
}

function OptionSelect({ label, allLabel, value, options, onChange }: {
    label: string; allLabel: string; value: string; options: readonly FilterOption[]; onChange: (v: string) => void;
}): JSX.Element {
    return (
        <Field label={label}>
            <Select value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">{allLabel}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
        </Field>
    );
}

type ControlsProps = Pick<AddonErrorsToolbarProps, 'filters' | 'onFilters' | 'groups'>;

function FilterControls({ filters, onFilters, groups }: ControlsProps): JSX.Element {
    const set = (patch: Partial<AddonErrorsFilterState>): void => onFilters({ ...filters, ...patch });
    return (
        <div className="grid gap-4 lg:grid-cols-3">
            <OptionSelect label="Addon" allLabel="All addons" value={filters.addon}
                options={addonOptions(groups, filters.addon)} onChange={(addon) => set({ addon })} />
            <OptionSelect label="Member" allLabel="All members" value={filters.userId}
                options={memberOptions(groups, filters.userId)} onChange={(userId) => set({ userId })} />
            <Field label="Last seen">
                <Select value={filters.lastSeen} onChange={(e) => set({ lastSeen: e.target.value as LastSeenWindow })}>
                    {LAST_SEEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
            </Field>
        </div>
    );
}

function ExportButtons({ busy, onExport }: { busy: AddonErrorsExportFormat | null; onExport: (f: AddonErrorsExportFormat) => void }): JSX.Element {
    return (
        <div className="flex gap-2">
            <Button variant="secondary" loading={busy === 'json'} disabled={busy !== null} onClick={() => onExport('json')}>Export JSON</Button>
            <Button variant="secondary" loading={busy === 'csv'} disabled={busy !== null} onClick={() => onExport('csv')}>Export CSV</Button>
        </div>
    );
}

/** Search + funnel + export; "Clear all" resets the filters, never the search. */
export function AddonErrorsToolbar(p: AddonErrorsToolbarProps): JSX.Element {
    const [isOpen, setOpen] = useState(false);
    const count = activeFilterCount(p.filters);
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <SearchInput className="min-w-[12rem] flex-1" label="Search addon errors" placeholder="Search addon or message"
                    maxLength={ADDON_ERRORS_QUERY_MAX} value={p.query} onChange={p.onQuery} onSearch={p.onSearch} />
                <FilterEntryTrigger activeCount={count} isOpen={isOpen} onOpenChange={setOpen} />
                <ExportButtons busy={p.exportBusy} onExport={p.onExport} />
            </div>
            <FilterEntry activeCount={count} isOpen={isOpen} onOpenChange={setOpen} onClearAll={() => p.onFilters(EMPTY_ADDON_ERROR_FILTERS)}>
                <FilterControls filters={p.filters} onFilters={p.onFilters} groups={p.groups} />
            </FilterEntry>
        </div>
    );
}
