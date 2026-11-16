/**
 * ROK-2208 — default hub Forum ↔ Discord forum handlers: unlinked, no forum
 * channels. Specs override with `server.use()`; the builders shape payloads.
 */
import { http, HttpResponse } from 'msw';
import type {
    HubForumDiscordBinding, HubForumDiscordChannelOption, HubForumDiscordPreflight, HubForumDiscordSharedOption,
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

/** The shared `#hub-forums` as preflight reports it: made, one hub, 18 tags free. */
export function forumDiscordShared(overrides: Partial<HubForumDiscordSharedOption> = {}): HubForumDiscordSharedOption {
    return {
        channelId: '223456789012345678', name: 'hub-forums', sharedWith: 1, tagsUsed: 2, tagsFree: 18,
        tagName: 'saloon', missingPermissions: [], ...overrides,
    };
}

/** Preflight with the bot online, nothing missing and a free shared forum. */
export function forumDiscordPreflight(overrides: Partial<HubForumDiscordPreflight> = {}): HubForumDiscordPreflight {
    return { botOnline: true, missingToCreate: [], suggestedName: 'saloon', shared: forumDiscordShared(), ...overrides };
}

export const hubForumDiscordHandlers = [
    http.get(`${GUILDS}/:id/forum-discord/preflight`, () => HttpResponse.json(forumDiscordPreflight())),
    http.get(`${GUILDS}/:id/forum-discord`, () => HttpResponse.json({ binding: null })),
    http.get(`${GUILDS}/:id/forum-discord/channels`, () => HttpResponse.json({ channels: [] })),
];
