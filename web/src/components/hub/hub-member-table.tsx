/**
 * ROK-1830 S3b — the Members list in its two shells: the §4.21 box table from
 * 1024px up and the §4.18 stacked cards below it. Both read the same
 * `HubMemberColumn[]`, so a hub module adds a column once and it appears in
 * each. The module's row rule (WoW: the raid-role colour) is the left edge in
 * both shells.
 *
 * ROK-1173: both shells draw only the mounted slice `HubMemberVirtualList`
 * computes, with a spacer above and below it standing in for the rest. Every
 * row and band heading has the fixed height in `TABLE_METRICS` /
 * `CARD_METRICS`, which is what keeps the spacer maths exact.
 */
import type { JSX } from 'react';
import type { HubMemberColumn, HubMemberRow } from '../../plugins/hub-module';
import { CARD_METRICS, TABLE_METRICS, type VirtualSlice, type VisibleBand } from './hub-member-virtual.helpers';

export interface MemberShellProps {
    slice: VirtualSlice;
    columns: readonly HubMemberColumn[];
    rowClass: ((row: HubMemberRow) => string) | undefined;
}

const CELL = 'px-3 py-0 align-middle text-sm whitespace-nowrap';
const HEAD = 'px-3 py-2 text-left text-xs font-semibold text-muted whitespace-nowrap';
const BAND = 'bg-panel px-3 py-0 text-left text-xs font-semibold text-muted';

function bandHeading(band: VisibleBand['band']): string {
    return `${band.label} · ${band.rows.length}`;
}

function rule(row: HubMemberRow, rowClass: MemberShellProps['rowClass']): string {
    return rowClass ? rowClass(row) : 'border-transparent';
}

/** A spacer standing in for the rows that are not mounted. */
function TableSpacer({ height, span }: { height: number; span: number }): JSX.Element | null {
    if (height <= 0) return null;
    return <tbody aria-hidden="true"><tr style={{ height }}><td colSpan={span} className="p-0" /></tr></tbody>;
}

/** 1-based `aria-rowindex` of the band's first mounted item; the header row is 1. */
function firstRowIndex(visible: VisibleBand): number {
    return visible.firstItem + 2;
}

function TableBand({ visible, columns, rowClass }: { visible: VisibleBand } & Omit<MemberShellProps, 'slice'>): JSX.Element {
    const { band } = visible;
    const rowBase = firstRowIndex(visible) + (visible.showHeading ? 1 : 0);
    return (
        <tbody data-testid={band.testId}>
            {visible.showHeading && (
                <tr style={{ height: TABLE_METRICS.heading }} aria-rowindex={firstRowIndex(visible)}>
                    <th scope="colgroup" colSpan={columns.length} className={BAND}>{bandHeading(band)}</th>
                </tr>
            )}
            {visible.rows.map((row, i) => (
                <tr key={row.memberId} data-testid="guild-member-row" style={{ height: TABLE_METRICS.row }} aria-rowindex={rowBase + i}
                    className="border-t border-edge-subtle">
                    {columns.map((c, i) => (
                        <td key={c.id} className={`${CELL} ${i === 0 ? `border-l-2 ${rule(row, rowClass)}` : ''}`}>
                            <c.cell row={row} />
                        </td>
                    ))}
                </tr>
            ))}
        </tbody>
    );
}

export function HubMemberTable({ slice, columns, rowClass }: MemberShellProps): JSX.Element {
    return (
        <div data-testid="guild-members-table">
            {/* Windowed: assistive tech learns the full size from aria-rowcount (+1 for the header row). */}
            <table className="w-full border-collapse" aria-rowcount={slice.itemCount + 1}>
                <thead className="sticky top-0 z-10 border-b border-edge bg-surface">
                    <tr aria-rowindex={1}>
                        {columns.map((c) => <th key={c.id} scope="col" className={HEAD}>{c.header}</th>)}
                    </tr>
                </thead>
                <TableSpacer height={slice.top} span={columns.length} />
                {slice.bands.map((v) => <TableBand key={v.band.key} visible={v} columns={columns} rowClass={rowClass} />)}
                <TableSpacer height={slice.bottom} span={columns.length} />
            </table>
        </div>
    );
}

interface CardPosition { setSize: number; posInSet: number }

function MemberCard({ row, columns, rowClass, setSize, posInSet }: { row: HubMemberRow } & CardPosition & Omit<MemberShellProps, 'slice'>): JSX.Element {
    const [first, ...rest] = columns;
    return (
        <li data-testid="guild-member-row" style={{ height: CARD_METRICS.row }} aria-setsize={setSize} aria-posinset={posInSet}
            className={`flex flex-col justify-center gap-1 overflow-hidden border-b border-edge-subtle border-l-2 pl-2 last:border-b-0 ${rule(row, rowClass)}`}>
            {first && <div className="truncate text-sm"><first.cell row={row} /></div>}
            <div className="flex min-w-0 flex-nowrap items-center gap-x-2 overflow-hidden text-sm">
                {rest.map((c) => <c.cell key={c.id} row={row} />)}
            </div>
        </li>
    );
}

function CardBand({ visible, columns, rowClass }: { visible: VisibleBand } & Omit<MemberShellProps, 'slice'>): JSX.Element {
    const { band } = visible;
    return (
        <div data-testid={band.testId}>
            {visible.showHeading && (
                <p style={{ height: CARD_METRICS.heading }}
                    className="flex items-center border-b border-edge-subtle bg-panel px-3 text-xs font-semibold text-muted">
                    {bandHeading(band)}
                </p>
            )}
            <ul aria-label={band.label === '' ? 'Members' : `${band.label} members`} className="flex flex-col px-3">
                {visible.rows.map((row, i) => (
                    <MemberCard key={row.memberId} row={row} columns={columns} rowClass={rowClass}
                        setSize={band.rows.length} posInSet={visible.firstRow + i + 1} />
                ))}
            </ul>
        </div>
    );
}

export function HubMemberCards({ slice, columns, rowClass }: MemberShellProps): JSX.Element {
    return (
        <div data-testid="guild-members-cards">
            {slice.top > 0 && <div aria-hidden="true" style={{ height: slice.top }} />}
            {slice.bands.map((v) => <CardBand key={v.band.key} visible={v} columns={columns} rowClass={rowClass} />)}
            {slice.bottom > 0 && <div aria-hidden="true" style={{ height: slice.bottom }} />}
        </div>
    );
}
