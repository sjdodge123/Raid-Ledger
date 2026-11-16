/**
 * ROK-2208 S3 — the hub Forum ↔ Discord forum binding
 * (`guilds/:id/forum-discord`). GET status / channels are Officer+; PUT and
 * DELETE need `canManageDiscord`. Responses parse against the strict
 * contract schemas (`hub-forum-discord.schema.ts`).
 */
import {
    HubForumDiscordChannelOptionsSchema,
    HubForumDiscordStatusSchema,
    type HubForumDiscordChannelOptions,
    type HubForumDiscordStatus,
    type PutHubForumDiscordInput,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

export type {
    HubForumDiscordBinding, HubForumDiscordChannelOption, HubForumDiscordChannelOptions,
    HubForumDiscordMode, HubForumDiscordStatus, PutHubForumDiscordInput,
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

/** Bind (create or join); the server answers with the new status. */
export function putHubForumDiscord(guildId: number, input: PutHubForumDiscordInput): Promise<HubForumDiscordStatus> {
    return fetchApi(base(guildId), { method: 'PUT', body: JSON.stringify(input) }, HubForumDiscordStatusSchema);
}

/** Unlink; `deleteForum` removes a bot-made, unshared forum on Discord too. */
export function deleteHubForumDiscord(guildId: number, deleteForum: boolean): Promise<void> {
    const query = deleteForum ? '?deleteForum=true' : '';
    return fetchApi<void>(`${base(guildId)}${query}`, { method: 'DELETE' });
}
