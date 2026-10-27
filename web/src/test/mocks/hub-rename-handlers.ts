/**
 * ROK-1950 — MSW handlers for `PATCH /guilds/:id/name` (rename a hub). The
 * success handler records each body so a test can assert what was sent.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';

const API = 'http://localhost:3000';

/** One recorded rename call. */
export interface HubRenameCall {
    hubId: number;
    body: unknown;
}

/** Answers 200 and pushes `{ hubId, body }` onto `calls`. */
export function hubRenameHandler(calls: HubRenameCall[]): HttpHandler {
    return http.patch(`${API}/guilds/:id/name`, async ({ request, params }) => {
        const body: unknown = await request.json();
        const hubId = Number(params['id']);
        calls.push({ hubId, body });
        return HttpResponse.json({ id: hubId });
    });
}

/** Answers with `status` and the server's `message`, as the Nest exception filter does. */
export function hubRenameError(status: 400 | 403 | 404 | 409, message: string): HttpHandler {
    return http.patch(`${API}/guilds/:id/name`, () => HttpResponse.json({ message, statusCode: status }, { status }));
}
