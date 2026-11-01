/**
 * ROK-1926 — the per-signup rows of the Ready for next run card: a table on
 * wide screens (≥768px), a divided list on phone. Not ready rows first, the
 * first 10 shown and the rest behind a 44px "N more" disclosure. Chips reuse
 * `StatusChip` (tokens only, every chip titled); an n/a check is a dim "—"
 * in the table and is left out of the phone row.
 */
import { useId, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { StatusChip } from '../../../components/ui/status-chip';
import { Button } from '../../../components/ui/button';
import { overallCell, READY_ROWS, rowCells, sortSignups, type CheckCell, type ReadyRequirements, type ReadySignup } from './ready-check.helpers';

interface RowsProps {
    signups: readonly ReadySignup[];
    requirements: ReadyRequirements;
    wide: boolean;
    /** Accessible name of the table / list. */
    label: string;
}

const QUESTS_NA_TITLE = 'Quest data for Forever dungeons arrives after launch';
const PHONE_LABELS = [['level', 'Lvl'], ['quests', 'Quests'], ['saved', 'Saved'], ['ilvl', 'iLvl']] as const;
const TH = 'px-2 py-1 text-left text-xs font-medium text-muted';

function Name({ signup }: { signup: ReadySignup }): JSX.Element {
    if (!signup.characterId) return <span className="font-medium text-foreground">{signup.name}</span>;
    return (
        <Link to={`/characters/${signup.characterId}`}
            className="inline-flex min-h-11 items-center font-medium text-foreground hover:underline">{signup.name}</Link>
    );
}

function Chip({ cell, prefix }: { cell: CheckCell; prefix?: string }): JSX.Element {
    return <StatusChip tone={cell.tone} title={cell.title}>{prefix ? `${prefix} ${cell.label}` : cell.label}</StatusChip>;
}

function Cell({ cell }: { cell: CheckCell | null }): JSX.Element {
    if (!cell) return <td className="px-2 text-dim" title="Not applicable to this event">—</td>;
    return <td className="px-2"><Chip cell={cell} /></td>;
}

function ReadyHead({ questsTitle }: { questsTitle: string | undefined }): JSX.Element {
    return (
        <thead>
            <tr className="border-b border-edge">
                <th scope="col" className={TH}>Character</th>
                <th scope="col" className={TH}>Level</th>
                <th scope="col" className={TH} title={questsTitle}>Quests</th>
                <th scope="col" className={TH}>Saved</th>
                <th scope="col" className={TH}>Item level</th>
                <th scope="col" className={TH}>Ready</th>
            </tr>
        </thead>
    );
}

function ReadyTable({ signups, requirements, label, listId }: RowsProps & { listId: string }): JSX.Element {
    const questsTitle = requirements.questCount === 0 ? QUESTS_NA_TITLE : undefined;
    return (
        <div className="overflow-x-auto">
            <table id={listId} className="w-full text-sm">
                <caption className="sr-only">{label}</caption>
                <ReadyHead questsTitle={questsTitle} />
                <tbody className="divide-y divide-edge">
                    {signups.map((s) => {
                        const c = rowCells(s, requirements);
                        return (
                            <tr key={s.userId} className="h-11">
                                <th scope="row" className="px-2 text-left font-normal"><Name signup={s} /></th>
                                <Cell cell={c.level} /><Cell cell={c.quests} /><Cell cell={c.saved} /><Cell cell={c.ilvl} />
                                <td className="px-2"><Chip cell={overallCell(s, false)} /></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function ReadyList({ signups, requirements, label, listId }: RowsProps & { listId: string }): JSX.Element {
    return (
        <ul id={listId} aria-label={label} className="divide-y divide-edge">
            {signups.map((s) => {
                const c = rowCells(s, requirements);
                return (
                    <li key={s.userId} className="py-2 text-sm">
                        <div className="flex min-h-8 items-center justify-between gap-2">
                            <Name signup={s} />
                            <Chip cell={overallCell(s, true)} />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {PHONE_LABELS.map(([key, prefix]) => {
                                const cell = c[key];
                                return cell ? <Chip key={key} cell={cell} prefix={prefix} /> : null;
                            })}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

function MoreToggle({ hidden, open, listId, onToggle }: { hidden: number; open: boolean; listId: string; onToggle: () => void }): JSX.Element {
    return (
        <Button type="button" variant="bare" fullWidth aria-expanded={open} aria-controls={listId}
            data-testid="ready-check-more" onClick={onToggle}
            className="min-h-11 justify-start rounded-sm border-t border-edge text-left text-sm hover:opacity-80 [&>[data-button-label]]:w-full">
            <span className="flex w-full items-center justify-between gap-2 text-muted">
                <span>{open ? 'Show fewer' : `${hidden} more`}</span>
                <span aria-hidden="true">{open ? '▴' : '▾'}</span>
            </span>
        </Button>
    );
}

/** Sorted signup rows (table or list), capped at 10 with a disclosure for the rest. */
export function ReadyRows(props: RowsProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const listId = useId();
    const sorted = sortSignups(props.signups);
    const hidden = sorted.length - READY_ROWS;
    const shown = open || hidden <= 0 ? sorted : sorted.slice(0, READY_ROWS);
    const View = props.wide ? ReadyTable : ReadyList;
    return (
        <div>
            <View {...props} signups={shown} listId={listId} />
            {hidden > 0 && <MoreToggle hidden={hidden} open={open} listId={listId} onToggle={() => setOpen((v) => !v)} />}
        </div>
    );
}
