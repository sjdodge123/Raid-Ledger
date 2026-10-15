/**
 * ROK-1786 (S2 of ROK-1781): guild page content API — GM post, rules, links
 * and recommended addons under `/plugins/wow/guilds/:id`. Every response is
 * parsed by its contract schema.
 */
import type {
    CreateGuildAddonInput, GuildAddon, GuildAddonList, GuildProfile, UpdateGuildAddonInput, UpdateGuildProfileInput,
} from '@raid-ledger/contract';
import { GuildAddonListSchema, GuildAddonSchema, GuildProfileSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const base = (guildId: number): string => `/plugins/wow/guilds/${guildId}`;

export function fetchGuildProfile(guildId: number): Promise<GuildProfile> {
    return fetchApi(`${base(guildId)}/profile`, {}, GuildProfileSchema);
}

export function patchGuildProfile(guildId: number, input: UpdateGuildProfileInput): Promise<GuildProfile> {
    return fetchApi(`${base(guildId)}/profile`, { method: 'PATCH', body: JSON.stringify(input) }, GuildProfileSchema);
}

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
