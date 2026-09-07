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
    LfgConvertResponseSchema,
    LfgGroupDetailSchema,
    LfgHistoryResponseSchema,
    LfgIntentResponseSchema,
    LfgGroupSummarySchema,
    LfgHeartedGameSchema,
    LfgInviteResponseSchema,
    LfgOverlapResponseSchema,
    LfgSuggestionsResponseSchema,
    GameSlugLookupSchema,
    type ConvertLfgIntentsDto,
    type GameSlugLookupDto,
    type LfgConvertResponseDto,
    type LfgGroupDetailDto,
    type LfgHistoryResponseDto,
    type LfgIntentResponseDto,
    type LfgInviteResponseDto,
    type LfgGroupSummaryDto,
    type LfgHeartedGameDto,
    type LfgOverlapResponseDto,
    type LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import { fetchApi, fetchWithAuth } from './fetch-api';

const LfgGroupListSchema = z.array(LfgGroupSummarySchema);
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

/**
 * `POST /lfg/:gameId/invites` answered 429 — the GROUP's daily invite budget
 * is spent (ROK-1455 D13). `message` is the server's actionable copy. Every
 * recipient-scoped refusal is a 200 `{ status: 'skipped' }` instead, so this
 * is the only refusal a caller may branch on.
 */
export class LfgInviteCapError extends Error {
    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, LfgInviteCapError.prototype);
        this.name = 'LfgInviteCapError';
    }
}

/**
 * `POST /lfg/:gameId/invites` — DM one suggested player on the group's
 * behalf (ROK-1455 D6: one recipient per request).
 *
 * Uses `fetchWithAuth` rather than `fetchApi` because the 429 must stay
 * distinguishable from every other failure: it carries copy the UI renders
 * inline instead of a generic error.
 */
export async function inviteToGroup(
    gameId: number,
    userId: number,
): Promise<LfgInviteResponseDto> {
    const response = await fetchWithAuth(`/lfg/${gameId}/invites`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const serverMessage =
            body && typeof body === 'object' && 'message' in body
                ? String((body as { message: unknown }).message)
                : '';
        if (response.status === 429) throw new LfgInviteCapError(serverMessage);
        throw new Error(serverMessage || `HTTP ${response.status}`);
    }
    return LfgInviteResponseSchema.parse(await response.json());
}
