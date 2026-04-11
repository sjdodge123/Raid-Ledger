/**
 * VetoGameCard (ROK-938).
 * Individual game card for veto mode: cover, name, veto button, strikethrough.
 */
import type { JSX } from 'react';

interface Props {
    gameId: number;
    gameName: string;
    gameCoverUrl: string | null;
    vetoCount: number;
    isEliminated: boolean;
    isWinner: boolean;
    isMyVeto: boolean;
    revealed: boolean;
    canVeto: boolean;
    onVeto: () => void;
}

export function VetoGameCard({
    gameName,
    vetoCount,
    isEliminated,
    isWinner,
    isMyVeto,
    revealed,
    canVeto,
    onVeto,
}: Props): JSX.Element {
    return (
        <div
            data-testid="veto-game-card"
            data-vetoed={isMyVeto ? 'true' : undefined}
            data-eliminated={isEliminated ? 'true' : undefined}
            className={`relative bg-panel border rounded-lg p-3 transition-colors ${
                isWinner ? 'border-emerald-500' : isEliminated ? 'border-red-500/40 opacity-60' : 'border-edge'
            }`}
        >
            {isEliminated && (
                <div
                    data-testid="strikethrough-overlay"
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                    <div className="w-full h-0.5 bg-red-500 rotate-[-5deg]" />
                </div>
            )}

            {isWinner && (
                <div
                    data-testid="veto-winner"
                    className="absolute -top-2 -right-2 px-2 py-0.5 text-xs font-bold bg-emerald-600 text-white rounded-full"
                >
                    Winner
                </div>
            )}

            <div className="text-sm font-medium text-foreground mb-2 truncate">
                {gameName}
            </div>

            {revealed ? (
                <span data-testid="veto-count-revealed" className="text-xs text-muted">
                    {vetoCount} {vetoCount === 1 ? 'veto' : 'vetoes'}
                </span>
            ) : (
                <span data-testid="veto-count-hidden" className="text-xs text-dim">
                    Votes hidden
                </span>
            )}

            {canVeto && !isMyVeto && (
                <button
                    data-testid="veto-button"
                    type="button"
                    onClick={onVeto}
                    className="mt-2 w-full px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors"
                >
                    Veto
                </button>
            )}

            {isMyVeto && (
                <div className="mt-2 text-xs text-red-400 font-medium">Your veto</div>
            )}
        </div>
    );
}
