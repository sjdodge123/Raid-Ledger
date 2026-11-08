/**
 * ROK-2148 — the rank badge of a top-givers row: a crown for #1 and medal
 * tones for #2–3 (operator round 2: "medals for #1–3"), a plain number after.
 * Tokens only: warning (gold), secondary (silver), class-warrior (bronze).
 */
import type { JSX } from 'react';

const BASE = 'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs tabular-nums';
const TONE: Readonly<Record<1 | 2 | 3, string>> = {
    1: 'font-bold text-warning bg-warning/10 border-warning/40',
    2: 'font-bold text-secondary bg-secondary/10 border-edge-strong',
    3: 'font-bold text-class-warrior bg-class-warrior/10 border-class-warrior/40',
};

function Crown(): JSX.Element {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <path fill="currentColor" d="M2 5l3 3 3-5 3 5 3-3-1.2 7H3.2L2 5zm1.4 8.5h9.2v1.3H3.4z" />
        </svg>
    );
}

export function RankBadge({ rank }: { rank: number }): JSX.Element {
    const medal = rank === 1 || rank === 2 || rank === 3 ? TONE[rank] : 'font-medium text-dim border-transparent';
    return (
        <span data-testid="contributions-rank" data-rank={rank} title={`#${rank}`} className={`${BASE} ${medal}`}>
            {rank === 1 ? <><Crown /><span className="sr-only">1</span></> : rank}
        </span>
    );
}
