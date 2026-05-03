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
 *
 * Loading/unavailable/error states surface via the shared `AiStatusBanner`
 * (ROK-1114) so a mis-configured AI provider is visible to operators
 * instead of silently dropping the entire row.
 */
import { type JSX } from 'react';
import type { AiSuggestionDto } from '@raid-ledger/contract';
import { useAiSuggestions } from '../../hooks/use-ai-suggestions';
import { useAiSuggestionsAvailable } from '../../hooks/use-ai-suggestions-available';
import { AiSuggestionCard } from './AiSuggestionCard';
import { AiStatusBanner } from './AiStatusBanner';

export interface PersonalSuggestionsRowProps {
    lineupId: number;
    onPickSuggestion: (suggestion: AiSuggestionDto) => void;
}

function SuggestionSkeletons(): JSX.Element {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pb-2">
            {Array.from({ length: 4 }, (_, i) => (
                <div
                    key={i}
                    className="min-w-0 rounded-xl bg-panel border border-edge/50 animate-pulse"
                >
                    <div className="aspect-[3/4] bg-zinc-800/50 rounded-t-xl" />
                </div>
            ))}
        </div>
    );
}

function SectionHeader(): JSX.Element {
    return (
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
            Suggested for you
        </h3>
    );
}

interface PersonalSuggestionsState {
    aiAvailable: boolean;
    isLoading: boolean;
    isUnavailable: boolean;
    isError: boolean;
    suggestions: AiSuggestionDto[];
}

function useAiSuggestionsForPersonal(lineupId: number): PersonalSuggestionsState {
    const aiAvailable = useAiSuggestionsAvailable();
    const query = useAiSuggestions(lineupId, { personalize: true, enabled: aiAvailable });
    const result = query.data;
    const isUnavailable = result?.kind === 'unavailable';
    const suggestions =
        result && result.kind !== 'unavailable' ? result.data.suggestions : [];
    return {
        aiAvailable,
        isLoading: query.isLoading,
        isUnavailable,
        isError: query.isError,
        suggestions,
    };
}

function SuggestionsGrid({
    suggestions,
    lineupId,
    onPickSuggestion,
}: {
    suggestions: AiSuggestionDto[];
    lineupId: number;
    onPickSuggestion: (suggestion: AiSuggestionDto) => void;
}): JSX.Element {
    return (
        <div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pb-2"
            data-testid="personal-suggestions-grid"
        >
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
    );
}

export function PersonalSuggestionsRow({
    lineupId,
    onPickSuggestion,
}: PersonalSuggestionsRowProps): JSX.Element | null {
    // ROK-1114 round 3: when the AI plugin is uninstalled or admins
    // disabled the suggestions feature, render nothing — no header, no
    // skeleton, no banner. The query call below is also gated via the
    // shared `enabled` flag inside useAiSuggestions, so it never fires.
    const { aiAvailable, isLoading, isUnavailable, isError, suggestions } =
        useAiSuggestionsForPersonal(lineupId);

    if (!aiAvailable) return null;
    // Suppress the section entirely on empty success — keeps the modal
    // tidy when the LLM had no candidates to recommend.
    if (!isLoading && !isUnavailable && !isError && suggestions.length === 0) {
        return null;
    }
    return (
        <section className="space-y-2 mb-3" aria-label="Suggested for you">
            <SectionHeader />
            <AiStatusBanner isLoading={isLoading} isUnavailable={isUnavailable} isError={isError} />
            {isLoading && <SuggestionSkeletons />}
            {suggestions.length > 0 && (
                <SuggestionsGrid
                    suggestions={suggestions}
                    lineupId={lineupId}
                    onPickSuggestion={onPickSuggestion}
                />
            )}
        </section>
    );
}
