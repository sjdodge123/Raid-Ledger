/**
 * LFG read API client (ROK-1451 endpoints, consumed by ROK-1453 chips).
 *
 * Only the three read routes the chips need are wired here — writes
 * (`POST /lfg`, `DELETE /lfg/:gameId`) belong to the LFG page (ROK-1464).
 */
import { z } from 'zod';
import {
    LfgGroupDetailSchema,
    LfgGroupSummarySchema,
    LfgHeartedGameSchema,
    type LfgGroupDetailDto,
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
export async function getLfgGroup(
    gameId: number,
): Promise<LfgGroupDetailDto> {
    return fetchApi(`/lfg/${gameId}`, {}, LfgGroupDetailSchema);
}
