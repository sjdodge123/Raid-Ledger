/**
 * ROK-1893 P1 — MSW handlers for the hub invite endpoints. Not in the
 * default handler set — specs opt in with `server.use(...)` and read the
 * returned `calls` to assert what was (or was not) sent.
 */
import { http, HttpResponse } from 'msw';
import type { HubInvite, HubInviteJoinResponse, HubInviteList, HubInvitePreview } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

export function createMockHubInvitePreview(overrides: Partial<HubInvitePreview> = {}): HubInvitePreview {
    return {
        state: 'ok',
        hub: { id: 7, name: 'Night Owls', gameName: 'Valheim', gameCoverUrl: null, memberCount: 12, blurb: 'Late-night Vikings.' },
        alreadyMember: false,
        inDiscordServer: true,
        discordServerInviteUrl: 'https://discord.gg/abc123',
        ...overrides,
    };
}

export function createMockHubInvite(overrides: Partial<HubInvite> = {}): HubInvite {
    return {
        id: 1, token: 'tok_1', url: 'http://localhost:5173/h/tok_1',
        createdBy: { id: 42, displayName: 'visitor' },
        createdAt: '2026-10-20T00:00:00.000Z', expiresAt: null, maxUses: null,
        useCount: 0, revokedAt: null, canRevoke: true,
        ...overrides,
    };
}

function apiError(status: number, message: string) {
    return HttpResponse.json({ statusCode: status, message }, { status });
}

export function hubInvitePreviewHandler(preview: HubInvitePreview | 404, calls: string[] = []) {
    return http.get(`${API_BASE}/hubs/invites/:token`, ({ params }) => {
        calls.push(String(params.token));
        if (preview === 404) return apiError(404, 'Invite not found');
        return HttpResponse.json(preview);
    });
}

export function hubInviteJoinHandler(result: HubInviteJoinResponse | { status: number; message: string }, calls: string[] = []) {
    return http.post(`${API_BASE}/hubs/invites/:token/join`, ({ params }) => {
        calls.push(String(params.token));
        if ('status' in result) return apiError(result.status, result.message);
        return HttpResponse.json(result);
    });
}

export function hubInviteListHandler(list: HubInviteList) {
    return http.get(`${API_BASE}/hubs/:id/invites`, () => HttpResponse.json(list));
}

export function hubInviteCreateHandler(created: HubInvite, bodies: unknown[] = []) {
    return http.post(`${API_BASE}/hubs/:id/invites`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(created, { status: 201 });
    });
}

export function hubInviteRevokeHandler(calls: string[] = []) {
    return http.delete(`${API_BASE}/hubs/:id/invites/:inviteId`, ({ params }) => {
        calls.push(String(params.inviteId));
        return new HttpResponse(null, { status: 204 });
    });
}
