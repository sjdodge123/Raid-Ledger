/**
 * ROK-1750 — MSW handlers for the private-poll share-link endpoints:
 * preview (public), join (redeem) and reset (creator / admin). Not in the
 * default handler set — specs opt in with `server.use(...)` and read the
 * returned `calls` to assert what was (or was not) sent.
 */
import { http, HttpResponse } from 'msw';
import type {
    PollShareJoinResponseDto,
    PollSharePreviewDto,
    PollShareTokenResponseDto,
} from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

export const PREVIEW_URL = `${API_BASE}/scheduling-polls/share/:token`;
export const JOIN_URL = `${API_BASE}/scheduling-polls/share/:token/join`;
export const RESET_URL = `${API_BASE}/scheduling-polls/:matchId/share-token/reset`;

export function createMockPollSharePreview(overrides: Partial<PollSharePreviewDto> = {}): PollSharePreviewDto {
    return {
        gameName: 'Civilization VI',
        gameCoverUrl: null,
        creatorDisplayName: 'Roknua',
        isOpen: true,
        memberCount: 3,
        ...overrides,
    };
}

/** An API-style error body: `fetchApi` surfaces `message` on the thrown Error. */
function apiError(status: number, message: string) {
    return HttpResponse.json({ statusCode: status, message }, { status });
}

/** `GET /scheduling-polls/share/:token` — a preview, or the uniform 404. */
export function pollSharePreviewHandler(preview: PollSharePreviewDto | 404, calls: string[] = []) {
    return http.get(PREVIEW_URL, ({ params }) => {
        calls.push(String(params.token));
        if (preview === 404) return apiError(404, 'This link is no longer valid');
        return HttpResponse.json(preview);
    });
}

/** `POST /scheduling-polls/share/:token/join` — a join result, or an error status + message. */
export function pollShareJoinHandler(
    result: PollShareJoinResponseDto | { status: number; message: string },
    calls: string[] = [],
) {
    return http.post(JOIN_URL, ({ params }) => {
        calls.push(String(params.token));
        if ('status' in result) return apiError(result.status, result.message);
        return HttpResponse.json(result);
    });
}

/** `POST /scheduling-polls/:matchId/share-token/reset` — the rotated token. */
export function pollShareResetHandler(result: PollShareTokenResponseDto, calls: string[] = []) {
    return http.post(RESET_URL, ({ params }) => {
        calls.push(String(params.matchId));
        return HttpResponse.json(result);
    });
}
