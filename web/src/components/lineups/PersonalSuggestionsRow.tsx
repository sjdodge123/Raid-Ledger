/**
 * Per-user "Suggested for you" row rendered inside NominateModal's
 * search-state view (ROK-931 — architect Decision B). Calls the same
 * endpoint as AiSuggestionsPanel but with `?personalize=me` so the
 * server personalises to the current user's taste vector.
 *
 * On success: cards expose a "Pick" button that calls
 * `onPickSuggestion(dto)` — NominateModal sets its selected-game state
 * so PreviewCard takes over and the user can add a note before
 * confirming.
 */
import { type JSX } from 'react';
import type { AiSuggestionDto } from '@raid-ledger/contract';
import { useAiSuggestions } from '../../hooks/use-ai-suggestions';
import { AiSuggestionCard } from './AiSuggestionCard';

export interface PersonalSuggestionsRowProps {
    lineupId: number;
    onPickSuggestion: (suggestion: AiSuggestionDto) => void;
}

function LoadingSkeleton(): JSX.Element {
    return (
        <div className="flex gap-3 overflow-x-auto pb-2">
            {Array.from({ length: 3 }, (_, i) => (
                <div
                    key={i}
                    className="w-[180px] flex-shrink-0 rounded-xl bg-panel border border-edge/50 animate-pulse"
                >
                    <div className="aspect-[3/4] bg-zinc-800/50 rounded-t-xl" />
                </div>
            ))}
        </div>
    );
}

export function PersonalSuggestionsRow({
    lineupId,
    onPickSuggestion,
}: PersonalSuggestionsRowProps): JSX.Element | null {
    const query = useAiSuggestions(lineupId, { personalize: true });

    if (query.isLoading) {
        return (
            <section className="space-y-2 mb-3" aria-label="Suggested for you">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
                    Suggested for you
                </h3>
                <LoadingSkeleton />
            </section>
        );
    }
    const result = query.data;
    if (!result || result.kind === 'unavailable') return null;
    const suggestions = result.data.suggestions;
    if (suggestions.length === 0) return null;
    return (
        <section className="space-y-2 mb-3" aria-label="Suggested for you">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
                Suggested for you
            </h3>
            <div className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2" style={{ scrollbarWidth: 'none' }}>
                {suggestions.map((s) => (
                    <AiSuggestionCard
                        key={s.gameId}
                        suggestion={s}
                        lineupId={lineupId}
                        mode="pick"
                        onPick={onPickSuggestion}
                    />
                ))}
            </div>
        </section>
    );
}
