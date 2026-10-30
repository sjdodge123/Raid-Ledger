/**
 * ROK-1917 (W10) — the boss list of the "Raid progress" card: one 44px row per
 * `(encounter, difficulty)` — name (+ difficulty label when the encounter has
 * two), "First kill Nov 6" / "Not killed yet", kills and wipes — in the API's
 * order, the first 8 shown and the rest behind a 44px "N more bosses"
 * disclosure (spec Q3). Phone stacks the first-kill line under the name and
 * the counts on the right; ≥640px is four columns (approved mockup).
 * No per-boss link in v1 (spec Q4).
 */
import { useId, useState, type JSX } from 'react';
import type { WowRosterRaidProgressBossDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { RAID_PROGRESS_ROWS, firstKillLine, multiDifficultyEncounters, plural, rowDifficulty } from './raid-progress.helpers';

type Boss = WowRosterRaidProgressBossDto;

const ROW_CLASS = 'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1 '
    + 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4rem_4rem]';
const COUNT_CLASS = 'col-start-2 whitespace-nowrap text-right text-xs text-muted sm:row-start-1';

function Kills({ kills }: { kills: number }): JSX.Element {
    if (kills === 0) return <>{plural(0, 'kill')}</>;
    return <><b className="font-semibold text-success">{kills}</b> {kills === 1 ? 'kill' : 'kills'}</>;
}

function BossRow({ boss, label }: { boss: Boss; label: string | null }): JSX.Element {
    const killed = boss.firstKillAt !== null;
    return (
        <li data-testid="raid-progress-row" className={ROW_CLASS}>
            <span className="col-start-1 row-start-1 min-w-0 truncate text-sm font-medium text-foreground">
                {boss.name}
                {label !== null && (
                    <span data-testid="raid-progress-difficulty"
                        className="ml-1.5 rounded border border-edge px-1 text-[11px] font-normal text-dim">{label}</span>
                )}
            </span>
            <span className={`col-start-1 row-start-2 text-xs sm:col-start-2 sm:row-start-1 ${killed ? 'text-muted' : 'text-dim'}`}>
                {firstKillLine(boss.firstKillAt)}
            </span>
            <span data-testid="raid-progress-kills" className={`${COUNT_CLASS} row-start-1 sm:col-start-3`}><Kills kills={boss.kills} /></span>
            <span data-testid="raid-progress-wipes" className={`${COUNT_CLASS} row-start-2 sm:col-start-4`}>{plural(boss.wipes, 'wipe')}</span>
        </li>
    );
}

/** The boss rows, capped at 8 with a "N more bosses" toggle for the rest. */
export function BossList({ bosses }: { bosses: readonly Boss[] }): JSX.Element {
    const [open, setOpen] = useState(false);
    const listId = useId();
    const multi = multiDifficultyEncounters(bosses);
    const hidden = bosses.length - RAID_PROGRESS_ROWS;
    const shown = open || hidden <= 0 ? bosses : bosses.slice(0, RAID_PROGRESS_ROWS);
    return (
        <div>
            <ul id={listId} aria-label="Raid bosses" className="divide-y divide-edge border-t border-edge">
                {shown.map((b) => (
                    <BossRow key={`${b.encounterId}:${b.difficultyId}`} boss={b} label={rowDifficulty(b, multi)} />
                ))}
            </ul>
            {hidden > 0 && (
                <Button type="button" variant="bare" fullWidth aria-expanded={open} aria-controls={listId}
                    data-testid="raid-progress-more" onClick={() => setOpen((v) => !v)}
                    className="min-h-11 justify-start rounded-sm border-t border-edge text-left text-sm hover:opacity-80 [&>[data-button-label]]:w-full">
                    <span className="flex w-full items-center justify-between gap-2 text-muted">
                        <span>{open ? 'Show fewer bosses' : `${hidden} more ${hidden === 1 ? 'boss' : 'bosses'}`}</span>
                        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                    </span>
                </Button>
            )}
        </div>
    );
}
