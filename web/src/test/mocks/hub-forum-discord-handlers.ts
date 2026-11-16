/**
 * ROK-2208 — default hub Forum ↔ Discord forum handlers: unlinked, no forum
 * channels. Specs override with `server.use()`; the builders shape payloads.
 */
import { http, HttpResponse } from 'msw';
import type {
    HubForumDiscordBinding, HubForumDiscordChannelOption,
} from '../../components/hub/settings/hub-forum-discord-api';

const GUILDS = 'http://localhost:3000/guilds';

export function forumDiscordBinding(overrides: Partial<HubForumDiscordBinding> = {}): HubForumDiscordBinding {
    return {
        channelId: '123456789012345678', channelName: 'hub-forums', managed: true, shared: false, sharedWith: 0,
        tagName: null, boundAt: '2026-11-16T12:00:00.000Z', health: 'ok', missingPermissions: [], ...overrides,
    };
}

export function forumDiscordChannel(overrides: Partial<HubForumDiscordChannelOption> = {}): HubForumDiscordChannelOption {
    return { id: '223456789012345678', name: 'hub-forums', sharedWith: 1, tagsFree: 18, ...overrides };
}

export const hubForumDiscordHandlers = [
    http.get(`${GUILDS}/:id/forum-discord`, () => HttpResponse.json({ binding: null })),
    http.get(`${GUILDS}/:id/forum-discord/channels`, () => HttpResponse.json({ channels: [] })),
];
