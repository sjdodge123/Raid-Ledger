/**
 * ROK-1464 AC7 — the "you have a full group" nudge.
 *
 * Gated on the server-derived `isViable` alone (D5): the threshold comes from
 * Co-Optimus data, so a game without it gets NO prompt rather than a guessed
 * headcount. The prompt never schedules anything itself — it just offers the
 * same `Find a time` action the status bar carries.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { LFG_COPY } from './lfg-copy';

export interface LfgFullGroupPromptProps {
    group: LfgGroupDetailDto;
    onFindATime: () => void;
    isBusy?: boolean;
}

/** Renders nothing unless the server says the roster is already big enough. */
export function LfgFullGroupPrompt({
    group,
    onFindATime,
    isBusy,
}: LfgFullGroupPromptProps): JSX.Element | null {
    if (!group.isViable || group.viabilityThreshold == null) return null;
    // Same gate as the status bar: convert only accepts active participants.
    const holdsIntent = group.ownIntent != null;
    return (
        <div
            data-testid="lfg-full-group-prompt"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4"
        >
            <p className="text-sm font-semibold text-emerald-300">
                {LFG_COPY.fullGroupPrompt}
            </p>
            <button
                type="button"
                className="px-3 py-1.5 rounded-md text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                onClick={onFindATime}
                disabled={isBusy || !holdsIntent}
                title={holdsIntent ? undefined : LFG_COPY.findATimeNeedsIntent}
            >
                {LFG_COPY.findATime}
            </button>
        </div>
    );
}
