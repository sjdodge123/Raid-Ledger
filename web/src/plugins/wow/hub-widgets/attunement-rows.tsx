/**
 * ROK-1927 (W13) — the member rows of the Attunements detail (spec §5.2, mockup
 * F6): a table at ≥768px (Name · Status · Steps · Next step), a divided list on
 * phone (name + chip, then "3/7 steps · next step"). The first 10 rows show;
 * the rest sit behind the 44px "N more" disclosure copied from
 * `ready-check-rows.tsx`. Chips are `StatusChip` (tokens only, every chip titled).
 */
import { useId, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { StatusChip } from '../../../components/ui/status-chip';
import { Button } from '../../../components/ui/button';
import type { AttunementMemberRow } from './attunement-detail.helpers';

/** Rows shown before the "N more" disclosure. */
export const ATTUNEMENT_ROWS = 10;

interface RowsProps {
    rows: readonly AttunementMemberRow[];
    wide: boolean;
    /** Accessible name of the table / list. */
    label: string;
    /** Id for the table / list (the tab chips' `aria-controls`); generated when absent. */
    listId?: string;
}

const TH = 'px-2 py-1 text-left text-xs font-medium text-muted';

function Name({ row }: { row: AttunementMemberRow }): JSX.Element {
    if (row.characterId === null) return <span className="font-medium text-foreground">{row.name}</span>;
    return (
        <Link to={`/characters/${row.characterId}#quests`}
            className="inline-flex min-h-11 items-center font-medium text-foreground hover:underline">{row.name}</Link>
    );
}

function Chip({ row }: { row: AttunementMemberRow }): JSX.Element {
    return <StatusChip tone={row.tone} title={row.title}>{row.label}</StatusChip>;
}

/** Below-level note and a stale capture's "as of" (warning tone), under the chip. */
function Notes({ row }: { row: AttunementMemberRow }): JSX.Element | null {
    if (row.levelNote === null && !row.stale) return null;
    return (
        <>
            {row.levelNote !== null && <span data-testid="attunement-level-note" className="block text-xs text-muted">{row.levelNote}</span>}
            {row.stale && row.asOf !== null && <span data-testid="attunement-stale" className="block text-xs text-warning">{row.asOf}</span>}
        </>
    );
}

function DetailTable({ rows, label, listId }: Omit<RowsProps, 'wide' | 'listId'> & { listId: string }): JSX.Element {
    return (
        <div className="overflow-x-auto">
            <table id={listId} className="w-full text-sm">
                <caption className="sr-only">{label}</caption>
                <thead>
                    <tr className="border-b border-edge">
                        <th scope="col" className={TH}>Name</th><th scope="col" className={TH}>Status</th>
                        <th scope="col" className={TH}>Steps</th><th scope="col" className={TH}>Next step</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                    {rows.map((row) => (
                        <tr key={row.rowKey} data-testid="attunement-member" data-state={row.state} title={row.asOf ?? undefined} className="h-11">
                            <th scope="row" className="px-2 text-left font-normal"><Name row={row} /></th>
                            <td className="px-2 py-1"><Chip row={row} /><Notes row={row} /></td>
                            <td className="px-2 tabular-nums text-foreground">{row.steps}</td>
                            <td className="px-2 text-secondary">{row.next}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function DetailList({ rows, label, listId }: Omit<RowsProps, 'wide' | 'listId'> & { listId: string }): JSX.Element {
    return (
        <ul id={listId} aria-label={label} className="divide-y divide-edge">
            {rows.map((row) => (
                <li key={row.rowKey} data-testid="attunement-member" data-state={row.state} title={row.asOf ?? undefined} className="py-2 text-sm">
                    <div className="flex min-h-8 items-center justify-between gap-2">
                        <Name row={row} />
                        <Chip row={row} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                        {row.steps === '—' ? row.next : `${row.steps} steps · ${row.next}`}
                    </p>
                    <Notes row={row} />
                </li>
            ))}
        </ul>
    );
}

function MoreToggle({ hidden, open, listId, onToggle }: { hidden: number; open: boolean; listId: string; onToggle: () => void }): JSX.Element {
    return (
        <Button type="button" variant="bare" fullWidth aria-expanded={open} aria-controls={listId}
            data-testid="attunement-more" onClick={onToggle}
            className="min-h-11 justify-start rounded-sm border-t border-edge text-left text-sm hover:opacity-80 [&>[data-button-label]]:w-full">
            <span className="flex w-full items-center justify-between gap-2 text-muted">
                <span>{open ? 'Show fewer' : `Show ${hidden} more`}</span>
                <span aria-hidden="true">{open ? '▴' : '▾'}</span>
            </span>
        </Button>
    );
}

/** Sorted member rows (table or list), capped at 10 with a disclosure for the rest. */
export function AttunementRows({ rows, wide, label, listId: givenId }: RowsProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const ownId = useId();
    const listId = givenId ?? ownId;
    const hidden = rows.length - ATTUNEMENT_ROWS;
    const shown = open || hidden <= 0 ? rows : rows.slice(0, ATTUNEMENT_ROWS);
    const View = wide ? DetailTable : DetailList;
    return (
        <div>
            <View rows={shown} label={label} listId={listId} />
            {hidden > 0 && <MoreToggle hidden={hidden} open={open} listId={listId} onToggle={() => setOpen((v) => !v)} />}
        </div>
    );
}
