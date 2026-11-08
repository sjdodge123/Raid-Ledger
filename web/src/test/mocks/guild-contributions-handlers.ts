/**
 * ROK-2148 — MSW fixtures for the WoW: Forever "Guild contributions" card. The
 * default handler answers 403 (the card stays hidden), so hub Overview specs
 * that never look at it are unaffected. Specs `server.use()`
 * `guildContributionsGetHandler` with their own DTO.
 */
import { http, HttpResponse } from 'msw';
import type {
    GuildContributionsDto, GuildContributionsGiver, GuildContributionsMaster, GuildContributionsUser,
} from '@raid-ledger/contract';

export const GUILD_CONTRIBUTIONS_URL = 'http://localhost:3000/plugins/wow/guilds/:id/contributions';

const CHAR_ID = '11111111-1111-4111-8111-111111111111';

export function buildMaster(over: Partial<GuildContributionsMaster> = {}): GuildContributionsMaster {
    return {
        professionSkillLineId: 333, profession: 'Enchanting', title: 'Guild Enchanter',
        recipientName: 'Aldren', characterId: CHAR_ID, onRoster: true, ...over,
    };
}

export function buildGiver(over: Partial<GuildContributionsGiver> = {}): GuildContributionsGiver {
    return { rank: 1, userId: null, characterName: 'Aldren', characterId: CHAR_ID, characterCount: 1, items: 142, isYou: false, ...over };
}

export function buildUser(name: string, over: Partial<GuildContributionsUser> = {}): GuildContributionsUser {
    return { characterName: name, characterId: null, lastSeenAt: '2026-11-08T10:00:00.000Z', ...over };
}

/** No template, no givers, no users — every empty state. */
export function buildEmptyContributions(): GuildContributionsDto {
    return {
        template: null,
        masters: [],
        givers: {
            last30Days: [], allTime: [], youLast30Days: null, youAllTime: null,
            last30DaysTotal: 0, allTimeTotal: 0, countingSince: null, asOf: null,
        },
        users: [],
    };
}

export function guildContributionsGetHandler(body: GuildContributionsDto | 'forbidden') {
    return http.get(GUILD_CONTRIBUTIONS_URL, () => (body === 'forbidden'
        ? HttpResponse.json({ statusCode: 403, message: 'Not a member of this guild' }, { status: 403 })
        : HttpResponse.json(body)));
}

export const guildContributionsHandlers = [guildContributionsGetHandler('forbidden')];
