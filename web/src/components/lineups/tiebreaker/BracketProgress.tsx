/**
 * BracketProgress (ROK-1218).
 * Surfaces "voted in M of N matchups" so users know how far they are
 * through a multi-matchup bracket round. F-29 in the ROK-1193 audit.
 */
import type { JSX } from 'react';
import type { BracketMatchupDto } from '@raid-ledger/contract';

interface Props {
    matchups: BracketMatchupDto[];
}

export function BracketProgress({ matchups }: Props): JSX.Element | null {
    const active = matchups.filter((m) => m.isActive && !m.isBye);
    const total = active.length;
    if (total === 0) return null;
    const done = active.filter((m) => m.myVote !== null).length;

    return (
        <div
            data-testid="bracket-progress"
            data-done={done}
            data-total={total}
            className="mb-2 flex items-center justify-between gap-3 text-xs"
        >
            <span className="uppercase tracking-wider text-muted">Bracket progress</span>
            <span className="text-foreground tabular-nums">
                Voted in <span className="font-semibold text-emerald-300">{done}</span> of {total} matchups
            </span>
        </div>
    );
}
