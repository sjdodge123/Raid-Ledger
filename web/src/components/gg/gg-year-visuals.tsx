/**
 * The approved mockup's year visuals (ROK-2187): a 12-month events histogram
 * (busiest month highlighted) and a 52-week attendance strip with the longest
 * streak highlighted. Tokens only; static bars (no animation).
 */
import type { JSX } from 'react';
import { ggLongestRun, peakIndex } from './gg-year-visuals.helpers';

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Twelve monthly bars, the busiest one in the accent. */
export function GgMonthHistogram({ counts }: { counts: readonly number[] }): JSX.Element {
    const peak = peakIndex(counts);
    const max = Math.max(1, ...counts);
    const label = `Events per month — busiest: ${MONTH_NAMES[peak] ?? ''} (${counts[peak] ?? 0})`;
    return (
        <div role="img" aria-label={label} className="flex h-28 items-end gap-1 rounded-xl border border-edge bg-panel/60 p-3">
            {counts.slice(0, 12).map((v, i) => (
                <div key={i} data-testid="gg-hist-bar" data-peak={i === peak ? 'true' : 'false'} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span style={{ height: `${(v / max) * 100}%` }}
                        className={`w-full rounded-t ${i === peak ? 'bg-success' : 'bg-foreground/20'}`} />
                    <em className={`text-[10px] not-italic ${i === peak ? 'font-bold text-foreground' : 'text-muted'}`}>{MONTH_INITIALS[i]}</em>
                </div>
            ))}
        </div>
    );
}

function weekState(i: number, on: boolean, run: { start: number; length: number }): 'run' | 'on' | 'off' {
    if (run.length > 1 && i >= run.start && i < run.start + run.length) return 'run';
    return on ? 'on' : 'off';
}

const WEEK_CLASS = { run: 'bg-busy ring-2 ring-busy/35', on: 'bg-success', off: 'bg-foreground/10' } as const;

/** 52 week cells (13 per row): attended weeks lit, the longest streak ringed. */
export function GgWeekStreak({ weeks }: { weeks: readonly boolean[] }): JSX.Element {
    const run = ggLongestRun(weeks);
    return (
        <div role="img" aria-label={`${weeks.length} weeks, ${run.length}-week streak highlighted`}
            className="grid grid-cols-13 gap-1 rounded-xl border border-edge bg-panel/60 p-3">
            {weeks.map((on, i) => {
                const state = weekState(i, on, run);
                return <i key={i} data-testid="gg-week" data-state={state} className={`aspect-square rounded-sm ${WEEK_CLASS[state]}`} />;
            })}
        </div>
    );
}
