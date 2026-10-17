/**
 * ROK-1830 S3b — the Members list in its two shells: the §4.21 box table from
 * 1024px up and the §4.18 stacked cards below it. Both read the same
 * `HubMemberColumn[]`, so a hub module adds a column once and it appears in
 * each. The module's row rule (WoW: the raid-role colour) is the left edge in
 * both shells.
 */
import type { JSX } from 'react';
import type { HubMemberColumn, HubMemberRow } from '../../plugins/hub-module';
import type { HubMemberBand } from './hub-members.helpers';

interface ListProps {
    bands: readonly HubMemberBand[];
    columns: readonly HubMemberColumn[];
    rowClass: ((row: HubMemberRow) => string) | undefined;
}

const CELL = 'px-3 py-2.5 align-middle text-sm';
const HEAD = 'px-3 py-2 text-left text-xs font-semibold text-muted whitespace-nowrap';
const BAND = 'bg-panel px-3 py-1.5 text-left text-xs font-semibold text-muted';

function bandHeading(band: HubMemberBand): string {
    return `${band.label} · ${band.rows.length}`;
}

function TableBand({ band, columns, rowClass }: { band: HubMemberBand } & Omit<ListProps, 'bands'>): JSX.Element {
    return (
        <tbody data-testid={band.testId}>
            {band.label !== '' && (
                <tr>
                    <th scope="colgroup" colSpan={columns.length} className={BAND}>{bandHeading(band)}</th>
                </tr>
            )}
            {band.rows.map((row) => (
                <tr key={row.memberId} data-testid="guild-member-row" className="border-t border-edge-subtle">
                    {columns.map((c, i) => (
                        <td key={c.id} className={`${CELL} ${i === 0 ? `border-l-2 ${rowClass ? rowClass(row) : 'border-transparent'}` : ''}`}>
                            <c.cell row={row} />
                        </td>
                    ))}
                </tr>
            ))}
        </tbody>
    );
}

export function HubMemberTable({ bands, columns, rowClass }: ListProps): JSX.Element {
    return (
        <div className="max-w-full overflow-x-auto rounded-lg border border-edge" data-testid="guild-members-table">
            <table className="w-full border-collapse">
                <thead className="border-b border-edge bg-surface">
                    <tr>
                        {columns.map((c) => <th key={c.id} scope="col" className={HEAD}>{c.header}</th>)}
                    </tr>
                </thead>
                {bands.map((band) => <TableBand key={band.key} band={band} columns={columns} rowClass={rowClass} />)}
            </table>
        </div>
    );
}

function MemberCard({ row, columns, rowClass }: { row: HubMemberRow } & Omit<ListProps, 'bands'>): JSX.Element {
    const [first, ...rest] = columns;
    return (
        <li data-testid="guild-member-row"
            className={`flex flex-col gap-1 border-b border-edge-subtle border-l-2 py-2 pl-2 last:border-b-0 ${rowClass ? rowClass(row) : 'border-transparent'}`}>
            {first && <div className="text-sm"><first.cell row={row} /></div>}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {rest.map((c) => <c.cell key={c.id} row={row} />)}
            </div>
        </li>
    );
}

export function HubMemberCards({ bands, columns, rowClass }: ListProps): JSX.Element {
    return (
        <div className="rounded-lg border border-edge" data-testid="guild-members-cards">
            {bands.map((band) => (
                <div key={band.key} data-testid={band.testId}>
                    {band.label !== '' && (
                        <p className="border-b border-edge-subtle bg-panel px-3 py-1.5 text-xs font-semibold text-muted">{bandHeading(band)}</p>
                    )}
                    <ul aria-label={band.label === '' ? 'Members' : `${band.label} members`} className="flex flex-col px-3">
                        {band.rows.map((row) => <MemberCard key={row.memberId} row={row} columns={columns} rowClass={rowClass} />)}
                    </ul>
                </div>
            ))}
        </div>
    );
}
