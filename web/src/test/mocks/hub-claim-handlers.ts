/**
 * ROK-2153 — MSW handlers for the core hub claim routes:
 * `GET /guilds/:id/claim` and `POST /guilds/:id/claim/:candidateId`.
 * Not in the default handler list: a test opts in with `server.use(...)`.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { HubClaimCandidate, HubClaimErrorCode, HubClaimResult, HubClaimStatus } from '@raid-ledger/contract';
import { HUB_CLAIM_ERROR_STATUS } from '@raid-ledger/contract';

const API = 'http://localhost:3000';

export function buildHubClaimCandidate(over: Partial<HubClaimCandidate> = {}): HubClaimCandidate {
    return { id: 'c-1', name: 'Thrall', subtitle: 'Lv 60 Shaman', avatarUrl: null, detailPath: null, match: null, matchReason: null, ...over };
}

/** A consistent status: `unclaimedCount` = candidates, not truncated, no suggestion. */
export function buildHubClaimStatus(over: Partial<HubClaimStatus> = {}): HubClaimStatus {
    const candidates = over.candidates ?? [buildHubClaimCandidate()];
    return {
        provider: 'valheim', viewerIsMember: true, viewerHasClaim: false, unclaimedCount: candidates.length,
        suggested: null, candidates, truncated: false, claimOptions: 'none', ...over,
    };
}

export function buildHubClaimResult(over: Partial<HubClaimResult> = {}): HubClaimResult {
    return { claimed: buildHubClaimCandidate(), becameMember: false, characterId: null, ...over };
}

/** Answers every status GET with `status`; counts hits in `hits.count` when given. */
export function hubClaimStatusHandler(status: HubClaimStatus, hits?: { count: number }): HttpHandler {
    return http.get(`${API}/guilds/:id/claim`, () => {
        if (hits !== undefined) hits.count += 1;
        return HttpResponse.json(status);
    });
}

/** One recorded claim POST. */
export interface HubClaimCall {
    hubId: number;
    candidateId: string;
    body: unknown;
}

/** Answers every claim POST with `result` and records `{ hubId, candidateId, body }` onto `calls`. */
export function hubClaimPostHandler(result: HubClaimResult, calls: HubClaimCall[]): HttpHandler {
    return http.post(`${API}/guilds/:id/claim/:candidateId`, async ({ request, params }) => {
        const body: unknown = await request.json();
        calls.push({ hubId: Number(params['id']), candidateId: String(params['candidateId']), body });
        return HttpResponse.json(result);
    });
}

/** The core error body (`{ statusCode, error, code, message }`) for `code` on either route. */
export function hubClaimErrorHandler(method: 'get' | 'post', code: HubClaimErrorCode): HttpHandler {
    const status = HUB_CLAIM_ERROR_STATUS[code];
    const reply = () => HttpResponse.json({ statusCode: status, error: 'Error', code, message: code }, { status });
    return method === 'get'
        ? http.get(`${API}/guilds/:id/claim`, reply)
        : http.post(`${API}/guilds/:id/claim/:candidateId`, reply);
}
