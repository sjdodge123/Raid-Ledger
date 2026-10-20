/**
 * ROK-1870 — MSW handlers + factories for the Admin → Hubs queue. The store is
 * mutable so a test can watch a rejected/approved proposal leave the list.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { AdminHubEntry, HubProposal } from '@raid-ledger/contract';

const API = 'http://localhost:3000';

/** A pending proposal with sensible defaults. */
export function makeHubProposal(over: Partial<HubProposal> = {}): HubProposal {
    return {
        id: 1, gameId: 10, gameName: "Baldur's Gate 3", gameIconUrl: null,
        name: 'BG3 Crew', blurb: 'Weekly co-op runs.',
        proposedBy: { userId: 7, username: 'Shadowmere', avatarUrl: null },
        createdAt: '2026-10-19T12:00:00.000Z', ...over,
    };
}

/** An active community hub row as `GET /admin/hubs` returns it. */
export function makeAdminHub(over: Partial<AdminHubEntry> = {}): AdminHubEntry {
    return {
        id: 100, gameId: 10, gameName: "Baldur's Gate 3", name: 'Tav Party', blurb: null, status: 'active',
        memberCount: 4, leader: { userId: 8, username: 'Karlach' }, createdAt: '2026-10-01T12:00:00.000Z', ...over,
    };
}

export interface AdminHubsStore {
    proposals: HubProposal[];
    active: AdminHubEntry[];
    archived: AdminHubEntry[];
    requests: { method: string; path: string; body: unknown }[];
}

/** A fresh store seeded with the given rows. */
export function makeAdminHubsStore(seed: Partial<Omit<AdminHubsStore, 'requests'>> = {}): AdminHubsStore {
    return { proposals: [], active: [], archived: [], requests: [], ...seed };
}

async function record(store: AdminHubsStore, request: Request): Promise<unknown> {
    const body: unknown = await request.json().catch(() => null);
    store.requests.push({ method: request.method, path: new URL(request.url).pathname, body });
    return body;
}

const page = (items: AdminHubEntry[]): { items: AdminHubEntry[] } => ({ items });

function readHandlers(store: AdminHubsStore): HttpHandler[] {
    return [
        http.get(`${API}/admin/hubs/proposals`, () => HttpResponse.json({ items: store.proposals })),
        http.get(`${API}/admin/hubs`, ({ request }) => {
            const status = new URL(request.url).searchParams.get('status');
            return HttpResponse.json(page(status === 'archived' ? store.archived : store.active));
        }),
    ];
}

/** Handlers backed by `store`; mutations record their body and update the store. */
export function adminHubsHandlers(store: AdminHubsStore): HttpHandler[] {
    return [
        ...readHandlers(store),
        http.post(`${API}/admin/hubs/proposals/:id/approve`, async ({ request, params }) => {
            await record(store, request);
            store.proposals = store.proposals.filter((p) => String(p.id) !== params.id);
            return HttpResponse.json({ id: 500 });
        }),
        http.post(`${API}/admin/hubs/proposals/:id/reject`, async ({ request, params }) => {
            await record(store, request);
            store.proposals = store.proposals.filter((p) => String(p.id) !== params.id);
            return new HttpResponse(null, { status: 204 });
        }),
        http.post(`${API}/admin/hubs`, async ({ request }) => {
            await record(store, request);
            return HttpResponse.json({ id: 501 }, { status: 201 });
        }),
        http.post(`${API}/hubs/:id/leader`, async ({ request }) => {
            await record(store, request);
            return HttpResponse.json({ ok: true });
        }),
        http.patch(`${API}/hubs/:id/status`, async ({ request }) => {
            await record(store, request);
            return HttpResponse.json({ ok: true });
        }),
    ];
}

/** A 409 response with the server's message, for inline-error cases. */
export function conflict(method: 'post' | 'patch', path: string, message: string): HttpHandler {
    return http[method](`${API}${path}`, () => HttpResponse.json({ message, statusCode: 409 }, { status: 409 }));
}
