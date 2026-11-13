/**
 * ROK-1789 Part B (B-4) — one boss of a Progression-tab instance: name (+ the
 * difficulty label only when the instance spans >1 difficulty, B3), first
 * kill, kills, wipes and last pull. Same 44px row idiom and helpers as the
 * Overview card's `raid-progress-rows.tsx`, with a fifth "Last pull" column.
 */
import type { JSX } from 'react';
import type { WowProgressionBossDto } from '@raid-ledger/contract';
import { firstKillLine, plural } from '../hub-widgets/raid-progress.helpers';

const ROW_CLASS = 'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1 '
    + 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4rem_4rem_minmax(0,1fr)]';
const COUNT_CLASS = 'whitespace-nowrap text-right text-xs text-muted sm:row-start-1';

/** "Nov 10" in the viewer's locale. */
export function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Kills({ kills }: { kills: number }): JSX.Element {
    if (kills === 0) return <>{plural(0, 'kill')}</>;
    return <><b className="font-semibold text-success">{kills}</b> {kills === 1 ? 'kill' : 'kills'}</>;
}

/** One boss row; `showDifficulty` comes from the instance (B3). */
export function ProgressionBossRow({ boss, showDifficulty }: { boss: WowProgressionBossDto; showDifficulty: boolean }): JSX.Element {
    const killed = boss.firstKillAt !== null;
    return (
        <li data-testid="progression-boss-row" className={ROW_CLASS}>
            <span className="col-start-1 row-start-1 min-w-0 truncate text-sm font-medium text-foreground">
                {boss.name}
                {showDifficulty && boss.difficultyLabel !== null && (
                    <span data-testid="progression-boss-difficulty"
                        className="ml-1.5 rounded border border-edge px-1 text-[11px] font-normal text-dim">{boss.difficultyLabel}</span>
                )}
            </span>
            <span className={`col-start-1 row-start-2 text-xs sm:col-start-2 sm:row-start-1 ${killed ? 'text-muted' : 'text-dim'}`}>
                {firstKillLine(boss.firstKillAt)}
            </span>
            <span data-testid="progression-boss-kills" className={`${COUNT_CLASS} col-start-2 row-start-1 sm:col-start-3`}><Kills kills={boss.kills} /></span>
            <span data-testid="progression-boss-wipes" className={`${COUNT_CLASS} col-start-2 row-start-2 sm:col-start-4`}>{plural(boss.wipes, 'wipe')}</span>
            <span data-testid="progression-boss-last-pull" className="col-span-2 row-start-3 text-xs text-dim sm:col-span-1 sm:col-start-5 sm:row-start-1 sm:text-right">
                Last pull {shortDate(boss.lastPullAt)}
            </span>
        </li>
    );
}
