/**
 * ROK-1464 AC3 — "When everyone's free".
 *
 * A week strip for shape, then the best one or two windows as actionable rows.
 * ROK-1573 (approved H3): each row says "Lock in this event" and hands the
 * whole window up so the page can confirm it and create the event for exactly
 * that range. The poll lives once, in the hero — rows carry no poll button.
 */
import type { JSX } from 'react';
import type {
    LfgOverlapResponseDto,
    LfgOverlapWindowDto,
} from '@raid-ledger/contract';
import { LFG_COPY } from './lfg-copy';
import { LFG_ROW_ACTION_BTN } from './lfg-action-buttons';
import {
    buildDayStrip,
    formatWindowLabel,
    pickBestWindows,
    type OverlapDayStatus,
} from './overlap-strip.helpers';

export interface LfgOverlapPanelProps {
    overlap: LfgOverlapResponseDto | undefined;
    onLockIn: (window: LfgOverlapWindowDto) => void;
    isLoading?: boolean;
    isBusy?: boolean;
    /** Set → every row's Lock in is disabled and this is its tooltip. */
    disabledHint?: string;
}

type RowActionProps = Pick<LfgOverlapPanelProps, 'onLockIn' | 'isBusy' | 'disabledHint'>;

const DAY_CLS: Record<OverlapDayStatus, string> = {
    hit: 'bg-emerald-500/80 text-emerald-950',
    part: 'bg-emerald-500/20 text-emerald-300',
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

/** One actionable window: its human label plus Lock in. */
function WindowRow({
    window,
    onLockIn,
    isBusy,
    disabledHint,
}: RowActionProps & { window: LfgOverlapWindowDto }): JSX.Element {
    return (
        <li className="flex items-center justify-between gap-3 rounded-lg bg-overlay px-3 py-2">
            <span className="text-sm text-foreground">
                {formatWindowLabel(window)}
            </span>
            <button
                type="button"
                data-testid="lfg-lockin"
                className={LFG_ROW_ACTION_BTN}
                onClick={() => onLockIn(window)}
                disabled={isBusy || disabledHint != null}
                title={disabledHint}
            >
                {LFG_COPY.lockIn}
            </button>
        </li>
    );
}

/** Overlap panel body once a roster is big enough for overlap to mean anything. */
function OverlapBody({
    overlap,
    ...actions
}: RowActionProps & { overlap: LfgOverlapResponseDto }): JSX.Element {
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
                            {...actions}
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
    isLoading,
    ...actions
}: LfgOverlapPanelProps): JSX.Element {
    const tooSmall = !overlap || overlap.memberCount < 2;
    return (
        <section
            data-testid="lfg-overlap-panel"
            className="rounded-xl bg-surface p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-foreground">
                {LFG_COPY.overlapTitle}
            </h2>
            {isLoading && <p className="text-sm text-muted">Loading…</p>}
            {!isLoading && tooSmall && (
                <p className="text-sm text-muted">{LFG_COPY.overlapNeedsTwo}</p>
            )}
            {!isLoading && !tooSmall && (
                <OverlapBody overlap={overlap} {...actions} />
            )}
        </section>
    );
}
