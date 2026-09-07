/**
 * LFG API client — the ONE module for the whole `/lfg` surface.
 *
 * ROK-1453 owns the hub reads (`getLfgGroups` / `getLfgHearted`) and the two
 * writes behind the game-detail toggle; ROK-1464 adds the group page's
 * ROK-1463 reads plus `convertIntents` and the slug lookup. `getGameBySlug`
 * lives here because slug → id resolution only exists for the slug-addressed
 * group route (`/lfg/:gameSlug`).
 */
import { z } from 'zod';
import {
    CreateLfgIntentSchema,
    LfgConvertResponseSchema,
    LfgGroupDetailSchema,
    LfgHistoryResponseSchema,
    LfgIntentResponseSchema,
    LfgGroupSummarySchema,
    LfgHeartedGameSchema,
    LfgBridgeOffersResponseSchema,
    LfgOverlapResponseSchema,
    LfgSuggestionsResponseSchema,
    GameSlugLookupSchema,
    type ConvertLfgIntentsDto,
    type GameSlugLookupDto,
    type LfgConvertResponseDto,
    type LfgGroupDetailDto,
    type LfgHistoryResponseDto,
    type LfgIntentResponseDto,
    type LfgGroupSummaryDto,
    type LfgHeartedGameDto,
    type LfgBridgeOfferDto,
    type LfgOverlapResponseDto,
    type LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

const LfgGroupListSchema = z.array(LfgGroupSummarySchema);

/**
 * Body `createIntent` accepts: the create schema's INPUT side (ROK-1479 D2).
 *
 * `urgency` carries a `.default('week')` in the contract, so the OUTPUT type
 * (`CreateLfgIntentDto`) has it required while the wire body may omit it —
 * `z.input` is the shape a caller is actually allowed to send. Omitting
 * `urgency` entirely is what keeps every pre-1479 caller on the weekly clock.
 */
export type CreateLfgIntentInput = z.input<typeof CreateLfgIntentSchema>;
const LfgHeartedListSchema = z.array(LfgHeartedGameSchema);

/**
 * `GET /games/slug/:slug` — resolve a `games.slug` to its numeric id (ROK-1464).
 * 404s an unknown slug rather than importing it.
 */
export async function getGameBySlug(slug: string): Promise<GameSlugLookupDto> {
    return fetchApi(
        `/games/slug/${encodeURIComponent(slug)}`,
        {},
        GameSlugLookupSchema,
    );
}

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
 * `GET /lfg/bridge/:lineupId` — the caller's losing nominations on a decided
 * lineup that they hold no live intent on (ROK-1457). Recomputed live: a
 * game drops out on the next read once the caller raises a hand on it.
 */
export async function getLfgBridgeOffers(
    lineupId: number,
): Promise<LfgBridgeOfferDto[]> {
    return fetchApi(
        `/lfg/bridge/${lineupId}`,
        {},
        LfgBridgeOffersResponseSchema,
    );
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
 * `GET /lfg/:gameId/overlap` — windows the live roster could all play in
 * (ROK-1463). Empty below two live members.
 */
export async function getLfgOverlap(
    gameId: number,
): Promise<LfgOverlapResponseDto> {
    return fetchApi(`/lfg/${gameId}/overlap`, {}, LfgOverlapResponseSchema);
}

/**
 * `GET /lfg/:gameId/history` — past scheduled events and finished Quick Play
 * sessions for the game (ROK-1463).
 */
export async function getLfgHistory(
    gameId: number,
): Promise<LfgHistoryResponseDto> {
    return fetchApi(`/lfg/${gameId}/history`, {}, LfgHistoryResponseSchema);
}

/**
 * `GET /lfg/:gameId/suggestions` — players who might want in, each with at
 * least one reason (ROK-1463).
 */
export async function getLfgSuggestions(
    gameId: number,
): Promise<LfgSuggestionsResponseDto> {
    return fetchApi(
        `/lfg/${gameId}/suggestions`,
        {},
        LfgSuggestionsResponseSchema,
    );
}

/**
 * `POST /lfg` — raise the caller's hand for a game.
 *
 * Idempotent for an existing holder: a re-post refreshes the expiry clock
 * rather than creating a second intent.
 *
 * @param body - Game id plus the optional ROK-1479 urgency choice. A `week`
 *   request must not carry `ttlMinutes` (the contract rejects it, A2), so
 *   callers pass the key only for `urgency: 'now'`.
 */
export async function createIntent(
    body: CreateLfgIntentInput,
): Promise<LfgIntentResponseDto> {
    return fetchApi(
        '/lfg',
        { method: 'POST', body: JSON.stringify(body) },
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

/**
 * `POST /lfg/:gameId/convert` — record that the group converted into a poll or
 * an event (ROK-1464). Provenance only: the caller creates the poll/event
 * first and reports it here.
 */
export async function convertIntents(
    gameId: number,
    body: ConvertLfgIntentsDto,
): Promise<LfgConvertResponseDto> {
    return fetchApi(
        `/lfg/${gameId}/convert`,
        { method: 'POST', body: JSON.stringify(body) },
        LfgConvertResponseSchema,
    );
}
