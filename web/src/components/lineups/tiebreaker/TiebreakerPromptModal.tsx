/**
 * TiebreakerPromptModal (ROK-938).
 * Shown to operator when tied games are detected.
 * Offers bracket/veto mode selection or dismiss.
 */
import type { JSX } from 'react';
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import { useStartTiebreaker, useDismissTiebreaker } from '../../../hooks/use-tiebreaker';

interface Props {
    lineupId: number;
    /** Lineup title used in heading context (ROK-1063). */
    lineupTitle?: string;
    tiebreaker: TiebreakerDetailDto | null;
    onClose: () => void;
}

/** Game thumbnail in the tied games list. */
function TiedGameItem({ name }: { name: string }): JSX.Element {
    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-panel rounded-lg text-sm">
            <span className="text-foreground">{name}</span>
        </div>
    );
}

export function TiebreakerPromptModal({ lineupId, lineupTitle, tiebreaker, onClose }: Props): JSX.Element {
    const startMutation = useStartTiebreaker();
    const dismissMutation = useDismissTiebreaker();

    const tiedGames = tiebreaker?.matchups?.map((m) => m.gameA.gameName) ?? [];
    const heading = lineupTitle ? `Games tied in ${lineupTitle}` : 'Games are tied!';

    function handleStart(mode: 'bracket' | 'veto') {
        startMutation.mutate(
            { lineupId, mode, roundDurationHours: 24 },
            { onSuccess: onClose },
        );
    }

    function handleDismiss() {
        dismissMutation.mutate(lineupId, { onSuccess: onClose });
    }

    return (
        <div
            data-testid="tiebreaker-prompt-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
            <div className="bg-surface border border-edge rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
                <h2 className="text-lg font-bold text-foreground mb-2">
                    {heading}
                </h2>
                <p className="text-sm text-muted mb-4">
                    Multiple games have the same number of votes. Choose a tiebreaker mode to resolve the tie.
                </p>

                {tiedGames.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {tiedGames.map((name) => (
                            <TiedGameItem key={name} name={name} />
                        ))}
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    <button
                        type="button"
                        onClick={() => handleStart('bracket')}
                        disabled={startMutation.isPending}
                        className="w-full px-4 py-3 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
                    >
                        Bracket Tournament
                    </button>
                    <button
                        type="button"
                        onClick={() => handleStart('veto')}
                        disabled={startMutation.isPending}
                        className="w-full px-4 py-3 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-500 transition-colors disabled:opacity-50"
                    >
                        Veto Elimination
                    </button>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        disabled={dismissMutation.isPending}
                        className="w-full px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
                    >
                        Dismiss &mdash; proceed without tiebreaker
                    </button>
                </div>
            </div>
        </div>
    );
}
