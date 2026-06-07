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

/**
 * ROK-1316: how often to re-poll while a cold-cache response is `pending`,
 * and the cap on poll attempts before giving up. The background pre-gen job
 * fires ~2s after the cold read; the LLM round-trip is ≤60s, so ~15 polls at
 * a 3s cadence (~45s) covers the warm-up without an unbounded spinner.
 */
const PENDING_POLL_INTERVAL_MS = 3_000;
const PENDING_POLL_MAX_ATTEMPTS = 15;

export interface UseAiSuggestionsOptions {
  enabled?: boolean;
  personalize?: boolean;
}

/** True when the response is a cold-cache `pending` payload still warming. */
function isPending(result: AiSuggestionsResult | undefined): boolean {
  return result?.kind === 'ok' && result.data.pending === true;
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
    // ROK-1316: a cold read returns `pending: true` while the background
    // pre-gen job warms the cache. Poll until a real payload arrives, then
    // stop. Bounded so a stuck job falls back to the empty state instead of
    // a hung spinner.
    staleTime: (query) =>
      isPending(query.state.data) ? 0 : 5 * 60 * 1000,
    refetchInterval: (query) => {
      if (!isPending(query.state.data)) return false;
      // `dataUpdateCount` increments per successful fetch — cap the poll
      // attempts so a stuck pre-gen job falls back to the empty state.
      return query.state.dataUpdateCount < PENDING_POLL_MAX_ATTEMPTS
        ? PENDING_POLL_INTERVAL_MS
        : false;
    },
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}

/** Cache key helper exported so CommonGroundPanel can invalidate after nominate. */
export const aiSuggestionsQueryKey = AI_SUGGESTIONS_KEY;
