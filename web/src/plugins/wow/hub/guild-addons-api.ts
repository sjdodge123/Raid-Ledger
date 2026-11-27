/**
 * ROK-1786 (S2 of ROK-1781): the WoW plugin's recommended-addons API under
 * `/plugins/wow/guilds/:id/addons`. Moved out of core's
 * `components/hub/api/guild-content-api.ts` (ROK-2361), which keeps only the
 * core guild profile. Every response is parsed by its contract schema.
 */
import type { CreateGuildAddonInput, GuildAddon, GuildAddonList, UpdateGuildAddonInput } from '@raid-ledger/contract';
import { GuildAddonListSchema, GuildAddonSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const base = (guildId: number): string => `/plugins/wow/guilds/${guildId}`;

export function fetchGuildAddons(guildId: number): Promise<GuildAddonList> {
    return fetchApi(`${base(guildId)}/addons`, {}, GuildAddonListSchema);
}

/** `requirement` is optional on the wire (server default 'optional'). */
export type CreateAddonBody = Omit<CreateGuildAddonInput, 'requirement'> & Partial<Pick<CreateGuildAddonInput, 'requirement'>>;

export function createGuildAddon(guildId: number, input: CreateAddonBody): Promise<GuildAddon> {
    return fetchApi(`${base(guildId)}/addons`, { method: 'POST', body: JSON.stringify(input) }, GuildAddonSchema);
}

export function updateGuildAddon(guildId: number, addonId: number, input: UpdateGuildAddonInput): Promise<GuildAddon> {
    return fetchApi(`${base(guildId)}/addons/${addonId}`, { method: 'PATCH', body: JSON.stringify(input) }, GuildAddonSchema);
}

export function deleteGuildAddon(guildId: number, addonId: number): Promise<void> {
    return fetchApi<void>(`${base(guildId)}/addons/${addonId}`, { method: 'DELETE' });
}

/** The server answers with the reordered list. */
export function reorderGuildAddons(guildId: number, ids: number[]): Promise<GuildAddonList> {
    return fetchApi(`${base(guildId)}/addons/order`, { method: 'PUT', body: JSON.stringify({ ids }) }, GuildAddonListSchema);
}
