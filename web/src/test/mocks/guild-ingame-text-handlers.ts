/**
 * ROK-2136 — MSW fixtures for the WoW: Forever "Guild message" card. The
 * default handler answers a member with nothing set (the card stays hidden),
 * so hub Overview specs that never look at it are unaffected. Specs
 * `server.use()` `guildIngameTextGetHandler` with their own state.
 */
import { http, HttpResponse } from 'msw';
import type { GuildIngameText, GuildIngameTextField } from '@raid-ledger/contract';

export const GUILD_INGAME_TEXT_URL = 'http://localhost:3000/plugins/wow/guilds/:id/ingame-text';

/** Microseconds kept on purpose: the server compares `updatedAt` as an exact string. */
export const MOTD_UPDATED_AT = '2026-11-08T10:00:00.123456Z';
export const INFO_UPDATED_AT = '2026-11-08T09:00:00.654321Z';

export function buildIngameField(over: Partial<GuildIngameTextField> = {}): GuildIngameTextField {
    return { text: 'Raid tonight 8pm\nBring flasks', updatedAt: MOTD_UPDATED_AT, updatedBy: 'Mira', ...over };
}

export function buildGuildIngameText(
    motd: GuildIngameTextField | null,
    info: GuildIngameTextField | null,
    canEdit = false,
): GuildIngameText {
    return { guildId: 5, motd, info, viewer: { canEdit } };
}

/** GET → `body` (200), or the 403 a non-member gets. */
export function guildIngameTextGetHandler(body: GuildIngameText | 'forbidden') {
    return http.get(GUILD_INGAME_TEXT_URL, () => (body === 'forbidden'
        ? HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 })
        : HttpResponse.json(body)));
}

export const guildIngameTextHandlers = [guildIngameTextGetHandler(buildGuildIngameText(null, null))];
