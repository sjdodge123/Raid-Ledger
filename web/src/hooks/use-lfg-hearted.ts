/**
 * `GET /lfg/hearted` (ROK-1453 AC6) — the caller's hearted games that they
 * have no live intent on. Drives the games-page cold-start prompt.
 *
 * Longer `staleTime` than the group list: hearts change far less often than
 * intents, and the prompt is a nudge, not live state.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LfgHeartedGameDto } from '@raid-ledger/contract';
import { getLfgHearted } from '../lib/api/lfg-api';
import { getAuthToken } from './use-auth';

/** Shared query key for the hearted cold-start list. */
export const LFG_HEARTED_QUERY_KEY = ['lfg', 'hearted'] as const;

/** The hearted games eligible for a cold-start nudge. */
export function useLfgHearted(): UseQueryResult<LfgHeartedGameDto[]> {
    const token = getAuthToken();
    return useQuery<LfgHeartedGameDto[]>({
        queryKey: LFG_HEARTED_QUERY_KEY,
        queryFn: getLfgHearted,
        enabled: !!token,
        staleTime: 1000 * 60 * 5,
    });
}
