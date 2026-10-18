/**
 * ROK-1788 (S4 of ROK-1781): the guild page's read-only Discord channel
 * mirror — read the mirror, list bot-readable channels (editors), bind or
 * clear the channel. Every response is parsed by its contract schema.
 */
import type {
    GuildDiscordChannelListDto, GuildDiscordMirrorDto, SetGuildDiscordChannelDto,
} from '@raid-ledger/contract';
import { GuildDiscordChannelListSchema, GuildDiscordMirrorSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const base = (guildId: number): string => `/guilds/${guildId}/discord`;

export function fetchGuildDiscord(guildId: number): Promise<GuildDiscordMirrorDto> {
    return fetchApi(base(guildId), {}, GuildDiscordMirrorSchema);
}

export function fetchGuildDiscordChannels(guildId: number): Promise<GuildDiscordChannelListDto> {
    return fetchApi(`${base(guildId)}/channels`, {}, GuildDiscordChannelListSchema);
}

/** The server answers with the mirror of the new binding. */
export function putGuildDiscordChannel(guildId: number, body: SetGuildDiscordChannelDto): Promise<GuildDiscordMirrorDto> {
    return fetchApi(`${base(guildId)}/channel`, { method: 'PUT', body: JSON.stringify(body) }, GuildDiscordMirrorSchema);
}

export function deleteGuildDiscordChannel(guildId: number): Promise<void> {
    return fetchApi<void>(`${base(guildId)}/channel`, { method: 'DELETE' });
}
