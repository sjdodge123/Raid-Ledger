/**
 * ROK-1788 — default guild Discord mirror handlers: nothing bound, and a
 * connected bot with no readable channels. Specs override with `server.use()`;
 * the builders below shape the mirror / channel-list payloads.
 */
import { http, HttpResponse } from 'msw';
import type {
    GuildDiscordChannelListDto, GuildDiscordChannelOptionDto, GuildDiscordMessageDto, GuildDiscordMirrorDto,
} from '@raid-ledger/contract';

const GUILDS = 'http://localhost:3000/guilds';

export const PUBLIC_CHANNEL: GuildDiscordChannelOptionDto = { id: '111111111111111111', name: 'announcements', visibility: 'public' };
export const PRIVATE_CHANNEL: GuildDiscordChannelOptionDto = { id: '222222222222222222', name: 'officers', visibility: 'private' };

export function discordMessage(n: number, overrides: Partial<GuildDiscordMessageDto> = {}): GuildDiscordMessageDto {
    return {
        messageId: `90000000000000000${n}`,
        author: { discordUserId: `80000000000000000${n}`, displayName: `Poster ${n}`, avatarUrl: null },
        content: `Message number ${n}`,
        attachments: [], mentions: [], reactions: [],
        createdAt: `2026-10-1${n % 10}T12:00:00.000Z`, editedAt: null, embed: null,
        ...overrides,
    };
}

export function okMirror(messages: GuildDiscordMessageDto[], channel = PUBLIC_CHANNEL, serverName?: string): GuildDiscordMirrorDto {
    return {
        state: 'ok',
        channel: {
            ...channel, url: `https://discord.com/channels/333333333333333333/${channel.id}`,
            ...(serverName === undefined ? {} : { serverName }),
        },
        messages,
        fetchedAt: '2026-10-15T12:00:00.000Z',
    };
}

export const NO_CHANNELS: GuildDiscordChannelListDto = { connected: true, channels: [] };

export const guildDiscordHandlers = [
    http.get(`${GUILDS}/:id/discord`, () => HttpResponse.json({ state: 'unset' })),
    http.get(`${GUILDS}/:id/discord/channels`, () => HttpResponse.json(NO_CHANNELS)),
];
