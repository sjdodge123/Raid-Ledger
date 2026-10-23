/**
 * ROK-1893 P3 — `GET /hubs/:id/polls`: the open scheduling polls tagged to a
 * community hub, in the same shape as `GET /scheduling-polls/active`. The key
 * sits under `standalone-polls`, so creating a poll refreshes the list.
 */
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ActiveStandalonePollDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';

/** Prefix of every hub's polls list — invalidate it to refresh them all. */
export const hubPollsRootKey = ['standalone-polls', 'hub'] as const;

export const hubPollsKey = (hubId: number): readonly unknown[] => [...hubPollsRootKey, hubId];

/**
 * Refetch every hub's Open polls list. Called after a poll stops being open
 * (cancel, complete, lock-in) so a closed poll does not linger for the
 * five-minute default freshness window.
 */
export function invalidateHubPolls(qc: QueryClient): void {
    void qc.invalidateQueries({ queryKey: hubPollsRootKey });
}

export function getHubPolls(hubId: number): Promise<ActiveStandalonePollDto[]> {
    return fetchApi(`/hubs/${hubId}/polls`);
}

export function useHubPolls(hubId: number): UseQueryResult<ActiveStandalonePollDto[], Error> {
    return useQuery({ queryKey: hubPollsKey(hubId), queryFn: () => getHubPolls(hubId) });
}
