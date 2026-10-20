/**
 * ROK-1870 — MSW handlers for the community hub membership routes (§2.3).
 * Not in the default set: a spec opts in with `server.use(...communityHubHandlers)`
 * and reads `communityHubCalls` to assert what the UI sent.
 */
import { http, HttpResponse } from 'msw';

const API = 'http://localhost:3000';

/** Every membership request the handlers saw, as `METHOD path`. */
export const communityHubCalls: string[] = [];

function record(request: Request): void {
    communityHubCalls.push(`${request.method} ${new URL(request.url).pathname}`);
}

export const communityHubHandlers = [
    http.post(`${API}/hubs/:id/join`, ({ request }) => { record(request); return HttpResponse.json({ joined: true, memberCount: 4 }); }),
    http.delete(`${API}/hubs/:id/join`, ({ request }) => { record(request); return HttpResponse.json({ joined: false, memberCount: 2 }); }),
    http.delete(`${API}/hubs/:id/members/:userId`, ({ request }) => { record(request); return new HttpResponse(null, { status: 204 }); }),
    http.patch(`${API}/hubs/:id/members/:userId/role`, ({ request }) => { record(request); return HttpResponse.json({ ok: true }); }),
    http.put(`${API}/hubs/:id/bans/:userId`, ({ request }) => { record(request); return new HttpResponse(null, { status: 204 }); }),
    http.post(`${API}/hubs/:id/leader`, ({ request }) => { record(request); return HttpResponse.json({ ok: true }); }),
];
