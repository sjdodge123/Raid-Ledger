/**
 * ROK-1453 — MSW handlers for the two LFG reads the chips consume.
 *
 * The defaults answer EMPTY so specs that incidentally mount a games/events
 * surface don't trip `onUnhandledRequest: 'warn'` and don't accidentally grow
 * a chip they never asked for. Specs that assert on chips override with
 * `server.use(lfgGroupsHandler([...]))`.
 */
import { http, HttpResponse } from 'msw';
import type {
    LfgGroupSummaryFixture,
    LfgHeartedGameFixture,
} from '../factories/lfg';
import {
    createMockHistoryEntry,
    createMockLfgGroupDetail,
    createMockOverlapResponse,
    createMockSuggestion,
} from '../lfg-factories';

const API_BASE = 'http://localhost:3000';

/** `GET /lfg` — every game with at least one live intent. */
export function lfgGroupsHandler(groups: LfgGroupSummaryFixture[]) {
    return http.get(`${API_BASE}/lfg`, () => HttpResponse.json(groups));
}

/** `GET /lfg/hearted` — cold-start suggestions from the caller's hearts. */
export function lfgHeartedHandler(games: LfgHeartedGameFixture[]) {
    return http.get(`${API_BASE}/lfg/hearted`, () => HttpResponse.json(games));
}

/**
 * `GET /lfg` with a request counter — AC5 ("one request per games-page mount
 * regardless of tile count") is asserted on the length of the returned array.
 */
export function countingLfgGroupsHandler(groups: LfgGroupSummaryFixture[]) {
    const calls: string[] = [];
    const handler = http.get(`${API_BASE}/lfg`, ({ request }) => {
        calls.push(request.url);
        return HttpResponse.json(groups);
    });
    return { handler, calls };
}

/** Registered globally in `handlers.ts`. */
export const lfgHandlers = [lfgGroupsHandler([]), lfgHeartedHandler([])];

// ---------------------------------------------------------------------------
// ROK-1464 — the group page (`/lfg/:gameSlug`)
// ---------------------------------------------------------------------------
//
// Exported separately from the global `lfgHandlers` above: those answer EMPTY
// on purpose so unrelated surfaces grow no chips, whereas the group page needs
// data in every panel. Opt in with `server.use(...lfgGroupPageHandlers)`.

/** The slug/id pair the group-page specs address. */
export const LFG_TEST_SLUG = 'deep-rock-galactic';
export const LFG_TEST_GAME_ID = 7;

/** Minimal `GET /games/:id` payload — enough for the header badge row. */
export const lfgGameDetailFixture = {
    id: LFG_TEST_GAME_ID,
    igdbId: 1234,
    name: 'Deep Rock Galactic',
    slug: LFG_TEST_SLUG,
    coverUrl: 'https://example.test/cover.jpg',
    summary: 'Rock and stone.',
    currentUserOwns: true,
    currentUserWishlisted: false,
    ownerCount: 3,
    wishlistCount: 1,
    cooptimusOnlineMax: 4,
    cooptimusCouchMax: null,
    cooptimusComboCoop: null,
};

/** Happy-path group-page routes: a one-person group with data in every panel. */
export const lfgGroupPageHandlers = [
    http.get(`${API_BASE}/games/slug/:slug`, ({ params }) =>
        params.slug === LFG_TEST_SLUG
            ? HttpResponse.json({
                  id: LFG_TEST_GAME_ID,
                  slug: LFG_TEST_SLUG,
                  name: 'Deep Rock Galactic',
              })
            : HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    ),
    http.get(`${API_BASE}/games/${LFG_TEST_GAME_ID}`, () =>
        HttpResponse.json(lfgGameDetailFixture),
    ),
    http.get(`${API_BASE}/lfg/:gameId/overlap`, () =>
        HttpResponse.json(createMockOverlapResponse()),
    ),
    http.get(`${API_BASE}/lfg/:gameId/history`, () =>
        HttpResponse.json({
            gameId: LFG_TEST_GAME_ID,
            entries: [createMockHistoryEntry()],
        }),
    ),
    http.get(`${API_BASE}/lfg/:gameId/suggestions`, () =>
        HttpResponse.json({
            gameId: LFG_TEST_GAME_ID,
            suggestions: [createMockSuggestion()],
        }),
    ),
    http.get(`${API_BASE}/lfg/:gameId`, () =>
        HttpResponse.json(createMockLfgGroupDetail()),
    ),
];
