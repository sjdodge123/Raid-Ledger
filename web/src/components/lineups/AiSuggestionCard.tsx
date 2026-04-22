/**
 * Shared card used by both AI suggestion surfaces (ROK-931).
 *
 * Two modes:
 *   - `nominate` (default) — Nominate button fires the same
 *     `useNominateGame` mutation Common Ground uses, optimistically
 *     disabled when the lineup is at its nomination cap.
 *   - `pick` — used from inside NominateModal, fires the parent-
 *     supplied `onPick` callback which sets the modal's selected-game
 *     state so PreviewCard can take over.
 */
import { type JSX } from 'react';
import type { AiSuggestionDto } from '@raid-ledger/contract';
import { useNominateGame } from '../../hooks/use-lineups';

export type AiSuggestionCardMode = 'nominate' | 'pick';

export interface AiSuggestionCardProps {
    suggestion: AiSuggestionDto;
    lineupId: number;
    mode?: AiSuggestionCardMode;
    atCap?: boolean;
    onPick?: (suggestion: AiSuggestionDto) => void;
}

function Cover({ src, alt }: { src: string | null; alt: string }): JSX.Element {
    if (src) {
        return (
            <img
                src={src}
                alt={alt}
                className="w-full aspect-[3/4] object-cover rounded-t-xl"
            />
        );
    }
    return (
        <div className="w-full aspect-[3/4] bg-panel rounded-t-xl flex items-center justify-center text-dim">
            No art
        </div>
    );
}

function OwnershipPill({ count, total }: { count: number; total: number }): JSX.Element | null {
    if (total === 0) return null;
    return (
        <span className="text-[10px] text-muted bg-surface/60 border border-edge/50 rounded-full px-2 py-0.5 whitespace-nowrap">
            {count}/{total} own
        </span>
    );
}

/** Single suggestion card — cover + name + reasoning + ownership + action button. */
export function AiSuggestionCard({
    suggestion,
    lineupId,
    mode = 'nominate',
    atCap = false,
    onPick,
}: AiSuggestionCardProps): JSX.Element {
    const nominate = useNominateGame();
    const isNominating = nominate.isPending && nominate.variables?.body.gameId === suggestion.gameId;

    const handleNominate = (): void => {
        nominate.mutate({ lineupId, body: { gameId: suggestion.gameId } });
    };

    const handlePick = (): void => {
        onPick?.(suggestion);
    };

    return (
        <div className="w-[180px] flex-shrink-0 rounded-xl bg-panel border border-edge/50 overflow-hidden flex flex-col">
            <Cover src={suggestion.coverUrl} alt={suggestion.name} />
            <div className="p-3 flex flex-col gap-2 flex-1">
                <h3 className="text-sm font-medium text-foreground line-clamp-1">{suggestion.name}</h3>
                <p className="text-xs text-muted line-clamp-2 min-h-[2rem]">{suggestion.reasoning}</p>
                <OwnershipPill count={suggestion.ownershipCount} total={suggestion.voterTotal} />
                {mode === 'nominate' ? (
                    <button
                        type="button"
                        onClick={handleNominate}
                        disabled={atCap || isNominating}
                        className="mt-auto px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-500 transition-colors disabled:opacity-50"
                    >
                        {isNominating ? 'Nominating…' : atCap ? 'At cap' : 'Nominate'}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handlePick}
                        className="mt-auto px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-500 transition-colors"
                    >
                        Pick
                    </button>
                )}
            </div>
        </div>
    );
}
