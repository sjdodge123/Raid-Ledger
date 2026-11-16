/**
 * ROK-2208 S3 — the hub Forum ↔ Discord forum binding
 * (`guilds/:id/forum-discord`). GET status / channels are Officer+; PUT and
 * DELETE need `canManageDiscord`; preflight is Leader+. Responses parse against the strict
 * contract schemas (`hub-forum-discord.schema.ts`).
 */
import {
    HubForumDiscordChannelOptionsSchema,
    HubForumDiscordPreflightSchema,
    HubForumDiscordStatusSchema,
    type HubForumDiscordChannelOptions,
    type HubForumDiscordPreflight,
    type HubForumDiscordStatus,
    type PutHubForumDiscordInput,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

export type {
    HubForumDiscordBinding, HubForumDiscordChannelOption, HubForumDiscordChannelOptions,
    HubForumDiscordMode, HubForumDiscordPreflight, HubForumDiscordSharedOption, HubForumDiscordStatus,
    HubForumDiscordTarget, PutHubForumDiscordInput,
} from '@raid-ledger/contract';

const base = (guildId: number): string => `/guilds/${guildId}/forum-discord`;

/** The hub's binding, or `{ binding: null }` while unlinked. */
export function fetchHubForumDiscord(guildId: number): Promise<HubForumDiscordStatus> {
    return fetchApi(base(guildId), {}, HubForumDiscordStatusSchema);
}

/** Forum channels the bot can see, with their share count and free tag slots. */
export function fetchHubForumDiscordChannels(guildId: number): Promise<HubForumDiscordChannelOptions> {
    return fetchApi(`${base(guildId)}/channels`, {}, HubForumDiscordChannelOptionsSchema);
}

/**
 * What the form needs before it can offer anything: bot online, the
 * permissions a create would lack, the own-forum name and the shared
 * `#hub-forums` (with its free tag slots). Never 503s — read it first.
 */
export function fetchHubForumDiscordPreflight(guildId: number): Promise<HubForumDiscordPreflight> {
    return fetchApi(`${base(guildId)}/preflight`, {}, HubForumDiscordPreflightSchema);
}

/** Bind (create or join); the server answers with the new status. */
export function putHubForumDiscord(guildId: number, input: PutHubForumDiscordInput): Promise<HubForumDiscordStatus> {
    return fetchApi(base(guildId), { method: 'PUT', body: JSON.stringify(input) }, HubForumDiscordStatusSchema);
}

/** Unlink; `deleteForum` removes a bot-made, unshared forum on Discord too. */
export function deleteHubForumDiscord(guildId: number, deleteForum: boolean): Promise<void> {
    const query = deleteForum ? '?deleteForum=true' : '';
    return fetchApi<void>(`${base(guildId)}${query}`, { method: 'DELETE' });
}
