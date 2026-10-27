/**
 * ROK-1853 — material totals. ≥1024px a sortable table (header buttons,
 * `aria-sort`); below, a stacked row list with a "Sort by" `Select`. A row
 * split across qualities shows its chest count as a lower bound (`≥ n`).
 * A row is a toggle (`aria-pressed`): selecting it narrows the chest list
 * to the chests holding that item (spec §3, Codex r2).
 * New pattern (docs/design-system.md §3.2): no shared sortable data table exists.
 */
import { Fragment, type JSX } from 'react';
import type { ValheimMaterialsTrend } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import type { ItemIconContext } from '../character/use-item-icons';
import type { TrendSummary } from '../trend/trend.helpers';
import {
    formatCount,
    formatQualities,
    showsQualityBreakdown,
    type MaterialRow,
    type MaterialSort,
    type MaterialSortKey,
    nextSort,
} from './materials.helpers';
import {
    ChestCount,
    COMPACT_ROW_CLS,
    RowIcon,
    RowToggle,
} from './materials-row-bits';
import { MaterialsTrendCell } from './materials-trend-cell';
import { rowTrends } from './materials-trend.helpers';

export interface TotalsTableProps {
    rows: readonly MaterialRow[];
    sort: MaterialSort;
    onSort: (next: MaterialSort) => void;
    ctx: ItemIconContext;
    caption: string;
    /** The prefab whose chests are listed, or null. */
    selected: string | null;
    onSelect: (prefab: string) => void;
    /** ROK-2014: the row set's play-day trend; absent → no chips, no Trend column. */
    trend?: ValheimMaterialsTrend | undefined;
}

/** The layouts get the rows' trends resolved once (empty map → no trend UI). */
type LayoutProps = Omit<TotalsTableProps, 'trend'> & {
    trends: ReadonlyMap<string, TrendSummary>;
};

const COLUMNS: { key: MaterialSortKey; label: string; numeric: boolean }[] = [
    { key: 'name', label: 'Item', numeric: false },
    { key: 'total', label: 'Total', numeric: true },
    { key: 'chests', label: 'Chests', numeric: true },
];

function SortHeader({
    col,
    sort,
    onSort,
}: {
    col: (typeof COLUMNS)[number];
    sort: MaterialSort;
    onSort: TotalsTableProps['onSort'];
}): JSX.Element {
    const active = sort.key === col.key;
    const ariaSort = active
        ? sort.dir === 'asc'
            ? 'ascending'
            : 'descending'
        : 'none';
    return (
        <th
            scope="col"
            aria-sort={ariaSort}
            className={`px-3 py-1 font-medium ${col.numeric ? 'text-right' : 'text-left'}`}
        >
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onSort(nextSort(sort, col.key))}
                className={active ? 'text-foreground' : ''}
            >
                {col.label}
                <span aria-hidden="true">
                    {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                </span>
            </Button>
        </th>
    );
}

function DesktopTable({
    rows,
    sort,
    onSort,
    ctx,
    caption,
    selected,
    onSelect,
    trends,
}: LayoutProps): JSX.Element {
    const showTrend = trends.size > 0;
    return (
        <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="text-muted">
                <tr className="border-b border-edge">
                    {COLUMNS.map((c) => (
                        <Fragment key={c.key}>
                            <SortHeader col={c} sort={sort} onSort={onSort} />
                            {showTrend && c.key === 'name' && (
                                <th
                                    scope="col"
                                    className="px-3 py-1 text-left font-medium"
                                >
                                    Trend
                                </th>
                            )}
                        </Fragment>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr
                        key={r.prefab}
                        className={`border-b border-edge last:border-0 ${selected === r.prefab ? 'bg-overlay' : ''}`}
                    >
                        <td className="px-3 py-2">
                            <RowToggle
                                row={r}
                                selected={selected === r.prefab}
                                onSelect={onSelect}
                                className="flex items-center gap-3 p-1"
                            >
                                <RowIcon prefab={r.prefab} ctx={ctx} />
                                <span className="text-foreground">
                                    {r.label}
                                </span>
                                {r.category !== null && (
                                    <span className="text-xs text-muted">
                                        {r.category}
                                    </span>
                                )}
                            </RowToggle>
                        </td>
                        {showTrend && <TrendTd trend={trends.get(r.prefab)} />}
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                            {formatCount(r.total)}
                            {showsQualityBreakdown(r.qualities) && (
                                <span className="block text-xs text-muted">
                                    {formatQualities(r.qualities)}
                                </span>
                            )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-secondary">
                            <ChestCount row={r} unit={false} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

const SORT_OPTIONS: { value: string; label: string; sort: MaterialSort }[] = [
    {
        value: 'total',
        label: 'Most first',
        sort: { key: 'total', dir: 'desc' },
    },
    { value: 'name', label: 'Name A–Z', sort: { key: 'name', dir: 'asc' } },
    {
        value: 'chests',
        label: 'Most chests',
        sort: { key: 'chests', dir: 'desc' },
    },
];

function PhoneList({
    rows,
    sort,
    onSort,
    ctx,
    caption,
    selected,
    onSelect,
    trends,
}: LayoutProps): JSX.Element {
    return (
        <div className="space-y-2">
            <Select
                aria-label="Sort by"
                fieldSize="sm"
                value={sort.key}
                onChange={(e) =>
                    onSort(
                        SORT_OPTIONS.find((o) => o.value === e.target.value)
                            ?.sort ?? sort,
                    )
                }
            >
                {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </Select>
            <ul aria-label={caption} className="divide-y divide-edge">
                {rows.map((r) => (
                    <li key={r.prefab}>
                        <RowToggle
                            row={r}
                            selected={selected === r.prefab}
                            onSelect={onSelect}
                            className={`${COMPACT_ROW_CLS} ${selected === r.prefab ? 'bg-overlay' : ''}`}
                        >
                            <RowIcon prefab={r.prefab} ctx={ctx} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-foreground">
                                    {r.label}
                                </span>
                                <span className="block text-xs text-muted">
                                    {formatQualities(r.qualities)} ·{' '}
                                    <ChestCount row={r} unit />
                                </span>
                            </span>
                            <span className="text-sm tabular-nums text-foreground">
                                {formatCount(r.total)}
                            </span>
                        </RowToggle>
                        <PhoneTrend trend={trends.get(r.prefab)} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** Desktop: the chip in its own column between Item and Total (empty cell for a row without one). */
function TrendTd({ trend }: { trend: TrendSummary | undefined }): JSX.Element {
    return (
        <td className="px-3 py-2">
            {trend !== undefined && <MaterialsTrendCell trend={trend} />}
        </td>
    );
}

/**
 * Phone: the chip on its own line under the name (indented past the 36px icon,
 * the 12px gap and the row's 4px inset) — the row itself is one toggle
 * button, and a button cannot hold another.
 */
function PhoneTrend({ trend }: { trend: TrendSummary | undefined }): JSX.Element | null {
    if (trend === undefined) return null;
    return <MaterialsTrendCell trend={trend} className="pb-2 pl-13" />;
}

export function MaterialsTotalsTable({
    trend,
    ...props
}: TotalsTableProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const trends = rowTrends(props.rows, trend);
    if (props.rows.length === 0)
        return (
            <p className="py-6 text-center text-sm text-muted">
                No items match your search.
            </p>
        );
    return isDesktop ? (
        <DesktopTable {...props} trends={trends} />
    ) : (
        <PhoneList {...props} trends={trends} />
    );
}
