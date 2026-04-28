/**
 * BracketView container (ROK-938).
 * Renders SVG bracket tree + matchup voting cards.
 */
import type { JSX } from 'react';
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import { BracketTree } from './BracketTree';
import { BracketMatchupCard } from './BracketMatchupCard';
import { TiebreakerClosedNotice } from './TiebreakerClosedNotice';
import { useForceResolve } from '../../../hooks/use-tiebreaker';

interface Props {
    tiebreaker: TiebreakerDetailDto;
    lineupId: number;
}

export function BracketView({ tiebreaker, lineupId }: Props): JSX.Element {
    const forceResolve = useForceResolve();
    const matchups = tiebreaker.matchups ?? [];
    const currentRound = tiebreaker.currentRound ?? 1;
    const totalRounds = tiebreaker.totalRounds ?? 1;

    if (tiebreaker.status !== 'active') {
        return (
            <TiebreakerClosedNotice
                title="Bracket Tiebreaker"
                resolvedAt={tiebreaker.resolvedAt}
            />
        );
    }

    return (
        <div data-testid="bracket-view" className="mt-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-foreground">
                    Bracket Tiebreaker — Round {currentRound}
                </h3>
                <button
                    type="button"
                    onClick={() => forceResolve.mutate(lineupId)}
                    disabled={forceResolve.isPending}
                    className="px-3 py-1.5 text-xs font-medium text-amber-400 border border-amber-500/40 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                >
                    Force Resolve
                </button>
            </div>

            <BracketTree matchups={matchups} totalRounds={totalRounds} />

            <div className="mt-4 space-y-2">
                {matchups
                    .sort((a, b) => a.round - b.round || a.position - b.position)
                    .map((m) => (
                        <BracketMatchupCard
                            key={m.id}
                            matchup={m}
                            lineupId={lineupId}
                        />
                    ))}
            </div>
        </div>
    );
}
