/**
 * ROK-1573/1572 — dev-only copy of `LfgOverlapPanel` with the row action
 * renamed "Start a scheduling poll". The shipped label is a copy constant, so
 * it cannot be swapped by prop. Strip + label helpers are the REAL ones.
 */
import type { JSX } from 'react';
import type { LfgOverlapResponseDto, LfgOverlapWindowDto } from '@raid-ledger/contract';
import { LFG_COPY } from '../../pages/lfg/lfg-copy';
import {
    buildDayStrip,
    formatWindowLabel,
    pickBestWindows,
    type OverlapDayStatus,
} from '../../pages/lfg/overlap-strip.helpers';
import { WF_COPY } from './wireframe-variants';

const DAY_CLS: Record<OverlapDayStatus, string> = {
    hit: 'bg-emerald-500/80 text-emerald-950',
    part: 'bg-emerald-500/20 text-emerald-300',
    none: 'bg-overlay text-muted',
};

/** Mon–Sun shape strip, as shipped. */
function DayStrip({ overlap }: { overlap: LfgOverlapResponseDto }): JSX.Element {
    return (
        <div className="grid grid-cols-7 gap-1">
            {buildDayStrip(overlap.windows, overlap.memberCount).map((day) => (
                <div key={day.label} data-status={day.status} className={`rounded py-1 text-center text-[11px] font-semibold ${DAY_CLS[day.status]}`}>
                    {day.label}
                </div>
            ))}
        </div>
    );
}

/** One window row with the renamed action. */
function WindowRow({ window, onStartPoll }: { window: LfgOverlapWindowDto; onStartPoll: () => void }): JSX.Element {
    return (
        <li className="flex items-center justify-between gap-3 rounded-lg bg-overlay px-3 py-2">
            <span className="text-sm text-foreground">{formatWindowLabel(window)}</span>
            <button
                type="button"
                className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                onClick={onStartPoll}
            >
                {WF_COPY.startSchedulingPoll}
            </button>
        </li>
    );
}

/** "When everyone's free", proposed copy. */
export function WfOverlapPanel({ overlap, onStartPoll }: { overlap: LfgOverlapResponseDto; onStartPoll: () => void }): JSX.Element {
    const best = pickBestWindows(overlap.windows);
    return (
        <section data-testid="lfg-overlap-panel" className="rounded-xl bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{LFG_COPY.overlapTitle}</h2>
            <div className="space-y-3">
                <DayStrip overlap={overlap} />
                {best.length === 0 ? (
                    <p className="text-sm text-muted">{LFG_COPY.overlapEmpty}</p>
                ) : (
                    <ul className="space-y-2">
                        {best.map((w) => (
                            <WindowRow key={w.start} window={w} onStartPoll={onStartPoll} />
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
