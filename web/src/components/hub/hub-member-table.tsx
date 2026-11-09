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
 * `cardMetrics(columns)`, which is what keeps the spacer maths exact.
 *
 * ROK-2155: a phone card is three fixed lines when a column asks for its own
 * (`cardLine: 'own'`, WoW professions), and a hub kind whose column sets
 * `rowLink` gets whole-row click (design-system §4.32): the card is `relative`
 * and that column's one link stretches over it; the table row gets a mouse-only
 * `onClick` to the same href (a stretched link on a `<tr>` is unreliable in
 * WebKit). No `role=button`, no second link, no extra tab stop.
 */
import type { JSX, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HubMemberColumn, HubMemberRow } from '../../plugins/hub-module';
import { cardMetrics, TABLE_METRICS, type VirtualSlice, type VisibleBand } from './hub-member-virtual.helpers';

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

/** A phone card with an href: the containing block of the stretched link. */
const LINKED_CARD = 'relative transition-colors hover:bg-panel';
/** A table row with an href: clickable with the mouse; only rows that open something look clickable. */
const LINKED_ROW = 'cursor-pointer transition-colors hover:bg-panel';
/** Clicks on these keep their own behaviour instead of opening the row. */
const OWN_CLICK = 'a, button, input, select, textarea, [role="button"]';

function useNoRowHref(): string | undefined {
    return undefined;
}

/** The href the row opens (the `rowLink` column's hook), or undefined. Columns are stable per hub kind. */
function useRowHref(columns: readonly HubMemberColumn[], row: HubMemberRow): string | undefined {
    const useHref = columns.find((c) => c.rowLink !== undefined)?.rowLink ?? useNoRowHref;
    return useHref(row);
}

/**
 * The desktop row's mouse-only click: plain left clicks outside any control
 * open `href`; modified clicks are left to the name link (new tab / window),
 * and a drag that selected text inside the row does not navigate.
 */
function useRowClick(href: string | undefined): ((e: MouseEvent<HTMLTableRowElement>) => void) | undefined {
    const navigate = useNavigate();
    if (href === undefined) return undefined;
    return (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const own = e.target instanceof Element ? e.target.closest(OWN_CLICK) : null;
        if (own !== null && e.currentTarget.contains(own)) return;
        const sel = window.getSelection();
        if (sel !== null && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
        navigate(href);
    };
}

/** One cell; only the `rowLink` column on a linked phone card is told to stretch its link. */
function MemberCell({ column, row, stretch = false }: { column: HubMemberColumn; row: HubMemberRow; stretch?: boolean }): JSX.Element {
    const Cell = column.cell;
    return <Cell row={row} stretched={stretch && column.rowLink !== undefined} />;
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

type TableRowProps = { row: HubMemberRow; rowIndex: number } & Omit<MemberShellProps, 'slice'>;

function PlainTableRow({ row, rowIndex, columns, rowClass, href, onClick }: TableRowProps & {
    href?: string | undefined; onClick?: ((e: MouseEvent<HTMLTableRowElement>) => void) | undefined;
}): JSX.Element {
    return (
        <tr data-testid="guild-member-row" style={{ height: TABLE_METRICS.row }} aria-rowindex={rowIndex}
            className={`border-t border-edge-subtle ${href === undefined ? '' : LINKED_ROW}`} onClick={onClick}>
            {columns.map((c, i) => (
                <td key={c.id} className={`${CELL} ${i === 0 ? `border-l-2 ${rule(row, rowClass)}` : ''}`}>
                    <MemberCell column={c} row={row} />
                </td>
            ))}
        </tr>
    );
}

/** A row of a hub kind with `rowLink`: needs the router (its href hook and `useNavigate`). */
function LinkedTableRow(props: TableRowProps): JSX.Element {
    const href = useRowHref(props.columns, props.row);
    return <PlainTableRow {...props} href={href} onClick={useRowClick(href)} />;
}

/** Columns are stable per hub kind, so the row component (and its hooks) never flips between renders. */
function TableRow(props: TableRowProps): JSX.Element {
    return props.columns.some((c) => c.rowLink !== undefined) ? <LinkedTableRow {...props} /> : <PlainTableRow {...props} />;
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
                <TableRow key={row.memberId} row={row} rowIndex={rowBase + i} columns={columns} rowClass={rowClass} />
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

interface CardLayout { setSize: number; posInSet: number; height: number }

const CARD_LINE_CLASS = 'flex min-w-0 flex-nowrap items-center gap-x-2 overflow-hidden text-sm';

/** Line 1 the identity column, line 2 the meta line, line 3 (when any) the `cardLine: 'own'` columns. */
function MemberCard({ row, columns, rowClass, setSize, posInSet, height }: { row: HubMemberRow } & CardLayout & Omit<MemberShellProps, 'slice'>): JSX.Element {
    const [first, ...rest] = columns;
    const own = rest.filter((c) => c.cardLine === 'own');
    // Columns are stable per hub kind (module constants), so the rowLink hook call order is fixed.
    const linked = useRowHref(columns, row) !== undefined;
    return (
        <li data-testid="guild-member-row" style={{ height }} aria-setsize={setSize} aria-posinset={posInSet}
            className={`flex flex-col justify-center gap-1 overflow-hidden border-b border-edge-subtle border-l-2 pl-2 last:border-b-0 ${rule(row, rowClass)} ${linked ? LINKED_CARD : ''}`}>
            {first && <div className="truncate text-sm"><MemberCell column={first} row={row} stretch={linked} /></div>}
            <div data-testid="guild-member-card-meta" className={CARD_LINE_CLASS}>
                {rest.filter((c) => c.cardLine !== 'own').map((c) => <MemberCell key={c.id} column={c} row={row} stretch={linked} />)}
            </div>
            {own.length > 0 && (
                <div data-testid="guild-member-card-own-line" className={CARD_LINE_CLASS}>
                    {own.map((c) => <MemberCell key={c.id} column={c} row={row} stretch={linked} />)}
                </div>
            )}
        </li>
    );
}

function CardBand({ visible, columns, rowClass, height }: { visible: VisibleBand; height: number } & Omit<MemberShellProps, 'slice'>): JSX.Element {
    const { band } = visible;
    return (
        <div data-testid={band.testId}>
            {visible.showHeading && (
                <p style={{ height: cardMetrics(columns).heading }}
                    className="flex items-center border-b border-edge-subtle bg-panel px-3 text-xs font-semibold text-muted">
                    {bandHeading(band)}
                </p>
            )}
            <ul aria-label={band.label === '' ? 'Members' : `${band.label} members`} className="flex flex-col px-3">
                {visible.rows.map((row, i) => (
                    <MemberCard key={row.memberId} row={row} columns={columns} rowClass={rowClass} height={height}
                        setSize={band.rows.length} posInSet={visible.firstRow + i + 1} />
                ))}
            </ul>
        </div>
    );
}

export function HubMemberCards({ slice, columns, rowClass }: MemberShellProps): JSX.Element {
    const { row: height } = cardMetrics(columns);
    return (
        <div data-testid="guild-members-cards">
            {slice.top > 0 && <div aria-hidden="true" style={{ height: slice.top }} />}
            {slice.bands.map((v) => <CardBand key={v.band.key} visible={v} columns={columns} rowClass={rowClass} height={height} />)}
            {slice.bottom > 0 && <div aria-hidden="true" style={{ height: slice.bottom }} />}
        </div>
    );
}
