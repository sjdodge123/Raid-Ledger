/**
 * TanStack Query hook for the AI suggestions endpoint (ROK-931).
 *
 * Returns an `AiSuggestionsResult` discriminated union so callers can
 * branch on `kind === 'unavailable'` to render the inline 503 state
 * without inspecting error bodies.
 */
import { useQuery } from '@tanstack/react-query';
import {
  getAiSuggestions,
  type AiSuggestionsResult,
} from '../lib/api/ai-suggestions-api';
import { useAiSuggestionsAvailable } from './use-ai-suggestions-available';

/** Query key prefix for AI suggestion queries. */
const AI_SUGGESTIONS_KEY = ['ai-suggestions'] as const;

export interface UseAiSuggestionsOptions {
  enabled?: boolean;
  personalize?: boolean;
}

export function useAiSuggestions(
  lineupId: number | null | undefined,
  options: UseAiSuggestionsOptions = {},
) {
  const { enabled = true, personalize = false } = options;
  const aiAvailable = useAiSuggestionsAvailable();
  return useQuery<AiSuggestionsResult>({
    queryKey: [...AI_SUGGESTIONS_KEY, lineupId, { personalize }],
    queryFn: () => getAiSuggestions(lineupId as number, { personalize }),
    // ROK-1114: gate on the combined plugin+feature flag so a disabled
    // AI plugin (or admin toggle) never fires the request.
    enabled: enabled && aiAvailable && lineupId != null,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}

/** Cache key helper exported so CommonGroundPanel can invalidate after nominate. */
export const aiSuggestionsQueryKey = AI_SUGGESTIONS_KEY;
