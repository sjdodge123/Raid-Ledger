/**
 * Tie readiness API client (ROK-1374).
 *
 * The readiness card is a decision AID — these calls report the tied games and
 * record a human's pick. Nothing here ever selects a winner on its own.
 */
import type {
    PickTiebreakerDto,
    SetInstallSizeDto,
    TieReadinessResponseDto,
} from '@raid-ledger/contract';
import { fetchApi, fetchWithAuth } from './fetch-api';

/**
 * Fetch the readiness card for a lineup.
 *
 * Resolves to `null` when there is no tie hold: the API answers 404 for that
 * case, and "no hold" is an ordinary state the page renders nothing for — not
 * an error the query layer should retry or surface.
 */
export async function getTieReadiness(
    lineupId: number,
): Promise<TieReadinessResponseDto | null> {
    const response = await fetchWithAuth(`/lineups/${lineupId}/tie-readiness`, {});
    if (response.status === 404) return null;
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
            (body as { message?: string }).message ??
                `Failed to load tie readiness (HTTP ${response.status})`,
        );
    }
    return (await response.json()) as TieReadinessResponseDto;
}

/** Pick one of the tied games (creator/operator). Claims the grace window. */
export async function pickTieGame(
    lineupId: number,
    body: PickTiebreakerDto,
): Promise<TieReadinessResponseDto> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker/pick`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/** Undo a pick while the grace claim is still pending. */
export async function undoTiePick(
    lineupId: number,
): Promise<TieReadinessResponseDto> {
    return fetchApi(`/lineups/${lineupId}/tiebreaker/pick/undo`, {
        method: 'POST',
    });
}

/**
 * Record a game's install/download footprint. Community-shared and typed by a
 * human who read it on SteamDB — this app never fetches SteamDB (D11 / AC23).
 */
export async function setInstallSize(
    gameId: number,
    body: SetInstallSizeDto,
): Promise<{ ok: true }> {
    return fetchApi(`/games/${gameId}/install-size`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}
