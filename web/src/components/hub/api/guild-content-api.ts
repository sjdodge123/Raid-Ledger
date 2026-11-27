/**
 * ROK-1786 (S2 of ROK-1781): guild page content API — GM post, rules, links
 * under core `/guilds/:id/profile` (ROK-1831). The WoW plugin's recommended
 * addons live in `plugins/wow/hub/guild-addons-api.ts` (ROK-2361). Every
 * response is parsed by its contract schema.
 */
import type { GuildProfile, UpdateGuildProfileInput } from '@raid-ledger/contract';
import { GuildProfileSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const coreBase = (guildId: number): string => `/guilds/${guildId}`;

export function fetchGuildProfile(guildId: number): Promise<GuildProfile> {
    return fetchApi(`${coreBase(guildId)}/profile`, {}, GuildProfileSchema);
}

export function patchGuildProfile(guildId: number, input: UpdateGuildProfileInput): Promise<GuildProfile> {
    return fetchApi(`${coreBase(guildId)}/profile`, { method: 'PATCH', body: JSON.stringify(input) }, GuildProfileSchema);
}
