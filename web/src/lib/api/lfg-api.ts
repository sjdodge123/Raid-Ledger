/**
 * LFG read API client (ROK-1451 endpoints, consumed by ROK-1453 chips).
 *
 * The three reads the chips need, plus the two writes behind the game-detail
 * "Looking for group" toggle. ROK-1464 reuses `createIntent` / `withdrawIntent`
 * for the LFG page's own controls.
 */
import { z } from 'zod';
import {
    LfgGroupDetailSchema,
    LfgIntentResponseSchema,
    LfgGroupSummarySchema,
    LfgHeartedGameSchema,
    type LfgGroupDetailDto,
    type LfgIntentResponseDto,
    type LfgGroupSummaryDto,
    type LfgHeartedGameDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

const LfgGroupListSchema = z.array(LfgGroupSummarySchema);
const LfgHeartedListSchema = z.array(LfgHeartedGameSchema);

/**
 * `GET /lfg` — every game with at least one live intent (capped server-side).
 *
 * One request serves a whole page of tiles; callers must NOT fetch per game.
 */
export async function getLfgGroups(): Promise<LfgGroupSummaryDto[]> {
    return fetchApi('/lfg', {}, LfgGroupListSchema);
}

/**
 * `GET /lfg/hearted` — the caller's hearted games they have no live intent on.
 * Drives the cold-start prompt.
 */
export async function getLfgHearted(): Promise<LfgHeartedGameDto[]> {
    return fetchApi('/lfg/hearted', {}, LfgHeartedListSchema);
}

/**
 * `GET /lfg/:gameId` — one game's group, including a zero-count summary when
 * nobody is looking. Used by the single-game detail page.
 *
 * @param gameId - Numeric game id (the route is id-based, not slug-based).
 */
export async function getLfgGroup(gameId: number): Promise<LfgGroupDetailDto> {
    return fetchApi(`/lfg/${gameId}`, {}, LfgGroupDetailSchema);
}

/**
 * `POST /lfg` — raise the caller's hand for a game.
 *
 * Idempotent for an existing holder: a re-post refreshes the expiry clock
 * rather than creating a second intent.
 *
 * @param gameId - Game to look for a group on.
 */
export async function createIntent(
    gameId: number,
): Promise<LfgIntentResponseDto> {
    return fetchApi(
        '/lfg',
        { method: 'POST', body: JSON.stringify({ gameId }) },
        LfgIntentResponseSchema,
    );
}

/**
 * `DELETE /lfg/:gameId` — withdraw the caller's own intent. 204, no body.
 *
 * @param gameId - Game to stop looking for.
 */
export async function withdrawIntent(gameId: number): Promise<void> {
    await fetchApi(`/lfg/${gameId}`, { method: 'DELETE' });
}
