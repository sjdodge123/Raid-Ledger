/**
 * ROK-1893 P3 — `GET /hubs/:id/polls`: the open scheduling polls tagged to a
 * community hub, in the same shape as `GET /scheduling-polls/active`. The key
 * sits under `standalone-polls`, so creating a poll refreshes the list.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ActiveStandalonePollDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';

export const hubPollsKey = (hubId: number): readonly unknown[] => ['standalone-polls', 'hub', hubId];

export function getHubPolls(hubId: number): Promise<ActiveStandalonePollDto[]> {
    return fetchApi(`/hubs/${hubId}/polls`);
}

export function useHubPolls(hubId: number): UseQueryResult<ActiveStandalonePollDto[], Error> {
    return useQuery({ queryKey: hubPollsKey(hubId), queryFn: () => getHubPolls(hubId) });
}
