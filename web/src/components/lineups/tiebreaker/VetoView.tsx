/**
 * VetoView container (ROK-938).
 * Renders game grid with veto buttons, progress, blind/revealed state.
 */
import type { JSX } from 'react';
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import { VetoGameCard } from './VetoGameCard';
import { TiebreakerClosedNotice } from './TiebreakerClosedNotice';
import { useCastVeto, useForceResolve } from '../../../hooks/use-tiebreaker';

interface Props {
    tiebreaker: TiebreakerDetailDto;
    lineupId: number;
}

export function VetoView({ tiebreaker, lineupId }: Props): JSX.Element {
    const vetoMutation = useCastVeto();
    const forceResolve = useForceResolve();
    const veto = tiebreaker.vetoStatus;
    if (!veto) return <div>No veto data</div>;

    if (tiebreaker.status === 'resolved' || tiebreaker.status === 'dismissed') {
        return (
            <TiebreakerClosedNotice
                title="Veto Elimination"
                resolvedAt={tiebreaker.resolvedAt}
            />
        );
    }

    const remaining = veto.vetoCap - veto.totalVetoes;
    const canVeto = tiebreaker.status === 'active' && !veto.myVetoGameId && remaining > 0;

    return (
        <div data-testid="veto-view" className="mt-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-foreground">
                    Veto Elimination
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

            <p className="text-sm text-muted mb-3">
                {remaining > 0
                    ? `${remaining} veto${remaining === 1 ? '' : 'es'} remaining`
                    : 'All vetoes used'}
                {' '}(cap: {veto.vetoCap})
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {veto.games.map((g) => (
                    <VetoGameCard
                        key={g.gameId}
                        gameId={g.gameId}
                        gameName={g.gameName}
                        gameCoverUrl={g.gameCoverUrl}
                        vetoCount={g.vetoCount}
                        isEliminated={g.isEliminated}
                        isWinner={g.isWinner}
                        isMyVeto={veto.myVetoGameId === g.gameId}
                        revealed={veto.revealed}
                        canVeto={canVeto}
                        onVeto={() =>
                            vetoMutation.mutate({ lineupId, gameId: g.gameId })
                        }
                    />
                ))}
            </div>
        </div>
    );
}
