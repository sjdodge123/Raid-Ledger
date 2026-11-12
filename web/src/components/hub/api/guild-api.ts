/**
 * ROK-1785 (S1 of ROK-1781): guild page API calls — core `/guilds/:id` (ROK-1831).
 * WoW-plugin owned (spec D1); every response is parsed by its contract schema.
 */
import type { CreateGuildEditorInput, GuildEditor, GuildEditorList, GuildPage, GuildPastEventsPageDto, GuildRaidsDto } from '@raid-ledger/contract';
import { GuildEditorListSchema, GuildEditorSchema, GuildPageSchema, GuildPastEventsPageSchema, GuildRaidsSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

/** Core hub routes (ROK-1831) — every hub kind; WoW's `/plugins/wow/guilds` alias still answers. */
const BASE = '/guilds';

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

/** ROK-1787: the guild's tagged events, raid schedule, composition and attendance. 403 for non-members. */
export function fetchGuildRaids(guildId: number): Promise<GuildRaidsDto> {
    return fetchApi(`${BASE}/${guildId}/raids`, {}, GuildRaidsSchema);
}

/**
 * ROK-2185: one page (20) of the hub's ended events, newest first. `cursor` is the
 * previous page's opaque `nextCursor`, passed back verbatim; null = the newest page.
 * 403 for a viewer who cannot view the hub (a visitor).
 */
export function fetchGuildPastEvents(guildId: number, cursor: string | null): Promise<GuildPastEventsPageDto> {
    const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    return fetchApi(`${BASE}/${guildId}/events/past${query}`, {}, GuildPastEventsPageSchema);
}
