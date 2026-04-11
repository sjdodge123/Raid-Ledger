/**
 * Tiebreaker API client (ROK-938).
 */
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch tiebreaker detail for a lineup. */
export async function getTiebreakerDetail(
    lineupId: number,
): Promise<TiebreakerDetailDto | null> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker`);
}

/** Start a tiebreaker (operator). */
export async function startTiebreaker(
    lineupId: number,
    body: { mode: 'bracket' | 'veto'; roundDurationHours?: number },
): Promise<TiebreakerDetailDto> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/** Dismiss a tiebreaker (operator). */
export async function dismissTiebreaker(
    lineupId: number,
): Promise<void> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker/dismiss`, {
        method: 'POST',
    });
}

/** Cast a bracket vote. */
export async function castBracketVote(
    lineupId: number,
    body: { matchupId: number; gameId: number },
): Promise<TiebreakerDetailDto> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker/bracket-vote`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/** Submit a veto. */
export async function castVeto(
    lineupId: number,
    body: { gameId: number },
): Promise<TiebreakerDetailDto> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker/veto`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/** Force-resolve tiebreaker (operator). */
export async function forceResolveTiebreaker(
    lineupId: number,
): Promise<void> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker/resolve`, {
        method: 'POST',
    });
}
