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

/** ✨ AI Pick chip rendered in the top-left of every suggestion cover.
 * `reasoning` surfaces in the native title tooltip so the modal stays clean. */
function AiBadge({ reasoning }: { reasoning?: string }): JSX.Element {
    return (
        <span
            className="absolute top-2 left-2 text-[10px] font-semibold tracking-wide uppercase bg-violet-500/90 text-white rounded-full px-2 py-0.5 shadow-sm"
            title={reasoning ?? 'Suggested by AI'}
        >
            ✨ AI Pick
        </span>
    );
}

function Cover({ src, alt, reasoning }: { src: string | null; alt: string; reasoning?: string }): JSX.Element {
    if (src) {
        return (
            <div className="relative">
                <img
                    src={src}
                    alt={alt}
                    className="w-full aspect-[3/4] object-cover rounded-t-xl"
                />
                <AiBadge reasoning={reasoning} />
            </div>
        );
    }
    return (
        <div className="relative w-full aspect-[3/4] bg-panel rounded-t-xl flex items-center justify-center text-dim">
            No art
            <AiBadge reasoning={reasoning} />
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

const ACTION_BTN_CLS =
    'mt-auto px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-500 transition-colors disabled:opacity-50';

function CardActions({
    mode,
    atCap,
    isNominating,
    onNominate,
    onPick,
}: {
    mode: AiSuggestionCardMode;
    atCap: boolean;
    isNominating: boolean;
    onNominate: () => void;
    onPick: () => void;
}): JSX.Element {
    if (mode === 'nominate') {
        return (
            <button type="button" onClick={onNominate} disabled={atCap || isNominating} className={ACTION_BTN_CLS}>
                {isNominating ? 'Nominating…' : atCap ? 'At cap' : 'Nominate'}
            </button>
        );
    }
    return (
        <button type="button" onClick={onPick} className={ACTION_BTN_CLS}>
            Pick
        </button>
    );
}

/** Single suggestion card — cover + name + reasoning + ownership + action button. */
export function AiSuggestionCard(props: AiSuggestionCardProps): JSX.Element {
    const { suggestion, lineupId, mode = 'nominate', atCap = false, onPick } = props;
    const nominate = useNominateGame();
    const isNominating = nominate.isPending && nominate.variables?.body.gameId === suggestion.gameId;
    const handleNominate = (): void => {
        nominate.mutate({ lineupId, body: { gameId: suggestion.gameId } });
    };
    const handlePick = (): void => {
        onPick?.(suggestion);
    };
    return (
        <div className="min-w-0 rounded-xl bg-panel border border-edge/50 overflow-hidden flex flex-col">
            <Cover src={suggestion.coverUrl} alt={suggestion.name} reasoning={suggestion.reasoning} />
            <div className="p-3 flex flex-col gap-2 flex-1">
                <h3 className="text-sm font-medium text-foreground line-clamp-1">{suggestion.name}</h3>
                <OwnershipPill count={suggestion.ownershipCount} total={suggestion.voterTotal} />
                <CardActions
                    mode={mode}
                    atCap={atCap}
                    isNominating={isNominating}
                    onNominate={handleNominate}
                    onPick={handlePick}
                />
            </div>
        </div>
    );
}
