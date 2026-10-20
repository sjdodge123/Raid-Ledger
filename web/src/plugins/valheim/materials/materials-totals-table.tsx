/**
 * ROK-1853 — material totals. ≥1024px a sortable table (header buttons,
 * `aria-sort`); below, a stacked row list with a "Sort by" `Select`. A row
 * split across qualities shows its chest count as a lower bound (`≥ n`).
 * A row is a toggle (`aria-pressed`): selecting it narrows the chest list
 * to the chests holding that item (spec §3, Codex r2).
 * New pattern (docs/design-system.md §3.2): no shared sortable data table exists.
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { ItemIcon } from '../character/item-icon';
import type { ItemIconContext } from '../character/use-item-icons';
import { resolveItem } from '../character/item-icon.helpers';
import {
    chestLowerBoundLabel,
    formatCount,
    formatQualities,
    isChestLowerBound,
    showsQualityBreakdown,
    type MaterialRow,
    type MaterialSort,
    type MaterialSortKey,
    nextSort,
} from './materials.helpers';

export interface TotalsTableProps {
    rows: readonly MaterialRow[];
    sort: MaterialSort;
    onSort: (next: MaterialSort) => void;
    ctx: ItemIconContext;
    caption: string;
    /** The prefab whose chests are listed, or null. */
    selected: string | null;
    onSelect: (prefab: string) => void;
}

const COLUMNS: { key: MaterialSortKey; label: string; numeric: boolean }[] = [
    { key: 'name', label: 'Item', numeric: false },
    { key: 'total', label: 'Total', numeric: true },
    { key: 'chests', label: 'Chests', numeric: true },
];

function RowIcon({
    prefab,
    ctx,
}: {
    prefab: string;
    ctx: ItemIconContext;
}): JSX.Element {
    const resolved = resolveItem(prefab, ctx.items, ctx.atlas);
    return (
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-panel">
            <ItemIcon resolved={resolved} prefab={prefab} ctx={ctx} />
        </span>
    );
}

/** The row's toggle: name (+ category) on desktop, the whole row on phone. */
function RowToggle({
    row,
    selected,
    onSelect,
    className,
    children,
}: {
    row: MaterialRow;
    selected: boolean;
    onSelect: (prefab: string) => void;
    className: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <Button
            variant="bare"
            aria-pressed={selected}
            title={`Show the chests holding ${row.label}`}
            onClick={() => onSelect(row.prefab)}
            className={`rounded-md text-left hover:bg-overlay ${className}`}
        >
            {children}
        </Button>
    );
}

/**
 * Phone/tablet row (ROK-1867): the Button label span is `inline-flex` and does
 * not stretch, so the icon + name + total sat centred; `[&>[data-button-label]]:w-full`
 * (the menu-item idiom) lets the name's `flex-1` push the total to the right.
 */
const COMPACT_ROW_CLS =
    'flex min-h-11 w-full items-center justify-start gap-3 px-1 py-2 text-left [&>[data-button-label]]:w-full [&>[data-button-label]]:gap-3';

/** Exact for one quality; `≥ n` (+ the spelt-out bound) when qualities split. */
function ChestCount({
    row,
    unit,
}: {
    row: MaterialRow;
    unit: boolean;
}): JSX.Element {
    const word = unit ? ` ${row.chests === 1 ? 'chest' : 'chests'}` : '';
    const count = `${formatCount(row.chests)}${word}`;
    if (!isChestLowerBound(row)) return <>{count}</>;
    const label = chestLowerBoundLabel(row.chests);
    return (
        <span title={label}>
            <span aria-hidden="true">≥ {count}</span>
            <span className="sr-only">{label}</span>
        </span>
    );
}

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
}: TotalsTableProps): JSX.Element {
    return (
        <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="text-muted">
                <tr className="border-b border-edge">
                    {COLUMNS.map((c) => (
                        <SortHeader
                            key={c.key}
                            col={c}
                            sort={sort}
                            onSort={onSort}
                        />
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
}: TotalsTableProps): JSX.Element {
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
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function MaterialsTotalsTable(props: TotalsTableProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (props.rows.length === 0)
        return (
            <p className="py-6 text-center text-sm text-muted">
                No items match your search.
            </p>
        );
    return isDesktop ? <DesktopTable {...props} /> : <PhoneList {...props} />;
}
