/**
 * ROK-1785 (S1 of ROK-1781): guild page API calls — `/plugins/wow/guilds`.
 * WoW-plugin owned (spec D1); every response is parsed by its contract schema.
 */
import type { CreateGuildEditorInput, GuildEditor, GuildEditorList, GuildPage } from '@raid-ledger/contract';
import { GuildEditorListSchema, GuildEditorSchema, GuildPageSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const BASE = '/plugins/wow/guilds';

/** Hero + roster by rank + the viewer's access. 403 when the viewer isn't a member. */
export function fetchGuildPage(guildId: number): Promise<GuildPage> {
    return fetchApi(`${BASE}/${guildId}`, {}, GuildPageSchema);
}

export function fetchGuildEditors(guildId: number): Promise<GuildEditorList> {
    return fetchApi(`${BASE}/${guildId}/editors`, {}, GuildEditorListSchema);
}

export function createGuildEditor(guildId: number, input: CreateGuildEditorInput): Promise<GuildEditor> {
    return fetchApi(`${BASE}/${guildId}/editors`, { method: 'POST', body: JSON.stringify(input) }, GuildEditorSchema);
}

export function deleteGuildEditor(guildId: number, editorId: number): Promise<void> {
    return fetchApi<void>(`${BASE}/${guildId}/editors/${editorId}`, { method: 'DELETE' });
}
