/**
 * Group-scope AI suggestions row mounted above Common Ground (ROK-931).
 *
 * Renders nothing on success when `suggestions` is empty (hidden
 * section per spec). Renders the inline "AI suggestions unavailable"
 * message when the hook reports `unavailable: true` (503 from no
 * configured LLM provider / circuit breaker open).
 */
import { type JSX } from 'react';
import { useAiSuggestions } from '../../hooks/use-ai-suggestions';
import { AiSuggestionCard } from './AiSuggestionCard';

export interface AiSuggestionsPanelProps {
    lineupId: number | null | undefined;
    atCap?: boolean;
}

function LoadingSkeleton(): JSX.Element {
    return (
        <div className="flex gap-3 overflow-x-auto pb-2">
            {Array.from({ length: 5 }, (_, i) => (
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

function UnavailableState(): JSX.Element {
    return (
        <p className="text-sm text-muted py-3">AI suggestions unavailable</p>
    );
}

function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <div className="flex items-center gap-2 py-3">
            <p className="text-sm text-muted">Failed to load AI suggestions.</p>
            <button
                onClick={onRetry}
                className="px-3 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-500"
            >
                Retry
            </button>
        </div>
    );
}

function SuccessRow({
    lineupId,
    suggestions,
    atCap,
}: {
    lineupId: number;
    suggestions: import('@raid-ledger/contract').AiSuggestionDto[];
    atCap: boolean;
}): JSX.Element {
    return (
        <div className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2" style={{ scrollbarWidth: 'none' }}>
            {suggestions.map((s) => (
                <AiSuggestionCard
                    key={s.gameId}
                    suggestion={s}
                    lineupId={lineupId}
                    mode="nominate"
                    atCap={atCap}
                />
            ))}
        </div>
    );
}

export function AiSuggestionsPanel({ lineupId, atCap = false }: AiSuggestionsPanelProps): JSX.Element | null {
    const query = useAiSuggestions(lineupId, { enabled: lineupId != null });

    if (lineupId == null) return null;
    if (query.isLoading) {
        return (
            <section className="space-y-2" aria-label="AI Suggestions">
                <h2 className="text-base font-semibold text-white">AI Suggestions</h2>
                <LoadingSkeleton />
            </section>
        );
    }
    if (query.isError) {
        return (
            <section className="space-y-2" aria-label="AI Suggestions">
                <h2 className="text-base font-semibold text-white">AI Suggestions</h2>
                <ErrorState onRetry={() => void query.refetch()} />
            </section>
        );
    }
    const result = query.data;
    if (!result) return null;
    if (result.kind === 'unavailable') {
        return (
            <section className="space-y-2" aria-label="AI Suggestions">
                <h2 className="text-base font-semibold text-white">AI Suggestions</h2>
                <UnavailableState />
            </section>
        );
    }
    const suggestions = result.data.suggestions;
    if (suggestions.length === 0) return null;
    return (
        <section className="space-y-2" aria-label="AI Suggestions">
            <h2 className="text-base font-semibold text-white">AI Suggestions</h2>
            <SuccessRow lineupId={lineupId} suggestions={suggestions} atCap={atCap} />
        </section>
    );
}
