/**
 * VetoGameCard (ROK-938).
 * Individual game card for veto mode: cover, name, veto button, strikethrough.
 */
import type { JSX } from 'react';
import { GameBadgeRow } from '../../games/game-badges';
import {
    fromVetoGameCard,
    type VetoGameCardData,
} from '../../games/game-badges.helpers';

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
    /**
     * ROK-1314: ownership / wishlist / price facts for the shared compact
     * badge row. Optional so a stale cached `VetoStatusDto` (whose card
     * objects predate these fields) renders the card exactly as before.
     */
    badges?: VetoGameCardData;
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
    badges,
}: Props): JSX.Element {
    return (
        <div
            data-testid="veto-game-card"
            data-vetoed={isMyVeto ? 'true' : undefined}
            data-eliminated={isEliminated ? 'true' : undefined}
            aria-label={isMyVeto ? `You eliminated ${gameName}` : undefined}
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

            {badges && (
                <GameBadgeRow
                    game={fromVetoGameCard(badges)}
                    variant="compact"
                    className="mb-2"
                />
            )}

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
