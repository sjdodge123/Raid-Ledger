/**
 * ROK-1832 — default per-group mute handlers: writes echo the requested state,
 * the viewer's muted-groups list is empty. Specs override with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import type { HubNotificationMuteItemDto } from '@raid-ledger/contract';

const API = 'http://localhost:3000';

/** One muted-group row for `GET /notifications/hub-mutes`. */
export function createMockHubMute(overrides: Partial<HubNotificationMuteItemDto> = {}): HubNotificationMuteItemDto {
    return { guildId: 7, name: 'Iron Vanguard', kind: 'wow_guild', gameName: 'World of Warcraft', mutedAt: '2026-10-19T12:00:00.000Z', ...overrides };
}

export const hubNotificationMuteHandlers = [
    http.post(`${API}/guilds/:id/notification-mute`, ({ params }) =>
        HttpResponse.json({ guildId: Number(params.id), muted: true })),
    http.delete(`${API}/guilds/:id/notification-mute`, ({ params }) =>
        HttpResponse.json({ guildId: Number(params.id), muted: false })),
    http.get(`${API}/notifications/hub-mutes`, () => HttpResponse.json({ data: [] })),
];
