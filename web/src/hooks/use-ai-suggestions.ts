/**
 * TanStack Query hook for the AI suggestions endpoint (ROK-931).
 *
 * Returns an `AiSuggestionsResult` discriminated union so callers can
 * branch on `kind === 'unavailable'` to render the inline 503 state
 * without inspecting error bodies.
 */
import { useState } from 'react';
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

/**
 * True when the response is a `stale` SWR payload (older voter-hash row
 * served while a refresh regenerates in the background, ROK-1316 r2). Stale
 * has content to render, so it polls WITHOUT the cold skeleton.
 */
function isStale(result: AiSuggestionsResult | undefined): boolean {
  return result?.kind === 'ok' && result.data.stale === true;
}

/**
 * True when the response should keep polling — either a cold `pending`
 * warm-up OR a `stale` revalidate. Drives `refetchInterval` so the client
 * actually observes the background refresh (the "revalidate" half of SWR).
 */
function isRevalidating(result: AiSuggestionsResult | undefined): boolean {
  return isPending(result) || isStale(result);
}

export function useAiSuggestions(
  lineupId: number | null | undefined,
  options: UseAiSuggestionsOptions = {},
) {
  const { enabled = true, personalize = false } = options;
  const aiAvailable = useAiSuggestionsAvailable();
  const query = useQuery<AiSuggestionsResult>({
    queryKey: [...AI_SUGGESTIONS_KEY, lineupId, { personalize }],
    queryFn: () => getAiSuggestions(lineupId as number, { personalize }),
    // ROK-1114: gate on the combined plugin+feature flag so a disabled
    // AI plugin (or admin toggle) never fires the request.
    enabled: enabled && aiAvailable && lineupId != null,
    // ROK-1316: a cold read returns `pending: true` while the background
    // pre-gen job warms the cache; a `stale` read serves an older voter-hash
    // row while a refresh regenerates (r2). Poll in BOTH cases until a fresh
    // (non-pending, non-stale) payload arrives, then stop. Bounded so a stuck
    // job doesn't poll forever.
    staleTime: (q) => (isRevalidating(q.state.data) ? 0 : 5 * 60 * 1000),
    refetchInterval: (q) => {
      if (!isRevalidating(q.state.data)) return false;
      // `dataUpdateCount` increments per successful fetch — cap the poll
      // attempts so a stuck job stops polling (skeleton falls back for cold;
      // stale just keeps its already-rendered content).
      return q.state.dataUpdateCount < PENDING_POLL_MAX_ATTEMPTS
        ? PENDING_POLL_INTERVAL_MS
        : false;
    },
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  // ROK-1316 rework #3: when polling has exhausted its cap and the payload
  // is STILL `pending` (pre-gen never completed), consumers must stop
  // rendering the skeleton and fall back to the empty/unavailable state.
  //
  // Implemented with React's documented "adjusting state when a prop
  // changes" pattern — comparing the latest values to previous-render values
  // held in STATE and calling setState DURING render (not in an effect, and
  // not via refs). This satisfies the react-hooks rules (which forbid both
  // synchronous setState in an effect AND ref access during render) while
  // still triggering a re-render so consumers observe the change.
  //
  // Accessing `query.dataUpdatedAt` registers it as a tracked prop, so React
  // Query re-renders this hook on every poll even when a stuck pre-gen
  // returns an IDENTICAL `pending` payload. Each render: a changed target
  // (lineupId/personalize) resets the budget (no carryover to a switched-to
  // cold lineup); a new fetch timestamp bumps the poll count while still
  // revalidating, or resets it once a fresh payload lands.
  const { dataUpdatedAt } = query;
  const targetKey = `${lineupId}:${personalize}`;
  const [tracked, setTracked] = useState({
    target: targetKey,
    updatedAt: dataUpdatedAt,
    count: 0,
  });

  let count = tracked.count;
  if (tracked.target !== targetKey) {
    count = 0;
    setTracked({ target: targetKey, updatedAt: dataUpdatedAt, count: 0 });
  } else if (tracked.updatedAt !== dataUpdatedAt) {
    count = isRevalidating(query.data) ? tracked.count + 1 : 0;
    setTracked({ target: targetKey, updatedAt: dataUpdatedAt, count });
  }

  // `pollExhausted` gates only the COLD skeleton — flip it solely for
  // `pending`. A capped-out `stale` just stops polling (refetchInterval)
  // while keeping its already-rendered content.
  const pollExhausted =
    isPending(query.data) && count >= PENDING_POLL_MAX_ATTEMPTS;

  return Object.assign(query, { pollExhausted });
}

/** Cache key helper exported so CommonGroundPanel can invalidate after nominate. */
export const aiSuggestionsQueryKey = AI_SUGGESTIONS_KEY;
