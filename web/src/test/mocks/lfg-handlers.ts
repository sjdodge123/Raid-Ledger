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
