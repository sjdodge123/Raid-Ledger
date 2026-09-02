/**
 * ROK-1464 AC3 — "When everyone's free".
 *
 * A week strip for shape, then the best one or two windows as actionable rows.
 * `Start poll` hands the whole window up so the caller can seed the poll's
 * first slot with `window.start` (D4) — the row is the only place that instant
 * is known.
 */
import type { JSX } from 'react';
import type {
    LfgOverlapResponseDto,
    LfgOverlapWindowDto,
} from '@raid-ledger/contract';
import { LFG_COPY } from './lfg-copy';
import {
    buildDayStrip,
    formatWindowLabel,
    pickBestWindows,
    type OverlapDayStatus,
} from './overlap-strip.helpers';

export interface LfgOverlapPanelProps {
    overlap: LfgOverlapResponseDto | undefined;
    onStartPoll: (window: LfgOverlapWindowDto) => void;
    isLoading?: boolean;
    isBusy?: boolean;
}

const DAY_CLS: Record<OverlapDayStatus, string> = {
    hit: 'bg-emerald-500/80 text-emerald-950',
    part: 'bg-emerald-500/25 text-emerald-200',
    none: 'bg-overlay text-muted',
};

/** Mon–Sun shape strip. Colour encodes how much of the roster a day can field. */
function DayStrip({
    overlap,
}: {
    overlap: LfgOverlapResponseDto;
}): JSX.Element {
    return (
        <div className="grid grid-cols-7 gap-1">
            {buildDayStrip(overlap.windows, overlap.memberCount).map((day) => (
                <div
                    key={day.label}
                    data-testid="lfg-overlap-day"
                    data-status={day.status}
                    className={`rounded py-1 text-center text-[11px] font-semibold ${DAY_CLS[day.status]}`}
                >
                    {day.label}
                </div>
            ))}
        </div>
    );
}

/** One actionable window: its human label plus the poll shortcut. */
function WindowRow({
    window,
    onStartPoll,
    isBusy,
}: {
    window: LfgOverlapWindowDto;
    onStartPoll: (window: LfgOverlapWindowDto) => void;
    isBusy?: boolean;
}): JSX.Element {
    return (
        <li className="flex items-center justify-between gap-3 rounded-lg bg-overlay px-3 py-2">
            <span className="text-sm text-zinc-200">
                {formatWindowLabel(window)}
            </span>
            <button
                type="button"
                className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                onClick={() => onStartPoll(window)}
                disabled={isBusy}
            >
                {LFG_COPY.startPoll}
            </button>
        </li>
    );
}

/** Overlap panel body once a roster is big enough for overlap to mean anything. */
function OverlapBody({
    overlap,
    onStartPoll,
    isBusy,
}: {
    overlap: LfgOverlapResponseDto;
    onStartPoll: (window: LfgOverlapWindowDto) => void;
    isBusy?: boolean;
}): JSX.Element {
    const best = pickBestWindows(overlap.windows);
    return (
        <div className="space-y-3">
            <DayStrip overlap={overlap} />
            {best.length === 0 ? (
                <p className="text-sm text-muted">{LFG_COPY.overlapEmpty}</p>
            ) : (
                <ul className="space-y-2">
                    {best.map((window) => (
                        <WindowRow
                            key={`${window.start}-${window.end}`}
                            window={window}
                            onStartPoll={onStartPoll}
                            isBusy={isBusy}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

/** The overlap panel. Below two live members there is nothing to overlap. */
export function LfgOverlapPanel({
    overlap,
    onStartPoll,
    isLoading,
    isBusy,
}: LfgOverlapPanelProps): JSX.Element {
    const tooSmall = !overlap || overlap.memberCount < 2;
    return (
        <section
            data-testid="lfg-overlap-panel"
            className="rounded-xl bg-surface p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-zinc-100">
                {LFG_COPY.overlapTitle}
            </h2>
            {isLoading && <p className="text-sm text-muted">Loading…</p>}
            {!isLoading && tooSmall && (
                <p className="text-sm text-muted">{LFG_COPY.overlapNeedsTwo}</p>
            )}
            {!isLoading && !tooSmall && (
                <OverlapBody
                    overlap={overlap}
                    onStartPoll={onStartPoll}
                    isBusy={isBusy}
                />
            )}
        </section>
    );
}
