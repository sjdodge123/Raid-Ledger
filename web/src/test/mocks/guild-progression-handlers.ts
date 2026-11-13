/**
 * ROK-1789 Part B — MSW fixtures for the WoW: Forever "Progression" tab
 * (`GET /plugins/wow/guilds/:id/progression`). The default handler answers an
 * empty page (no pulls, no activity) so hub specs that never open the tab are
 * unaffected. Specs `server.use()` `guildProgressionGetHandler` with their own page.
 */
import { http, HttpResponse } from 'msw';
import type {
    WowGuildProgressionPageDto,
    WowProgressionBossDto,
    WowProgressionInstanceDto,
} from '@raid-ledger/contract';

export const GUILD_PROGRESSION_URL = 'http://localhost:3000/plugins/wow/guilds/:id/progression';
export const PROGRESSION_NOV_6 = '2026-11-06T21:30:00.000Z';
export const PROGRESSION_NOV_10 = '2026-11-10T22:00:00.000Z';

/** One boss row: killed once on Nov 6 at 40-player, last pulled Nov 10. */
export function buildProgressionBoss(name: string, over: Partial<WowProgressionBossDto> = {}): WowProgressionBossDto {
    return {
        encounterId: name.length * 100, difficultyId: 9, difficultyLabel: '40-player', name,
        firstKillAt: PROGRESSION_NOV_6, kills: 1, wipes: 2, lastPullAt: PROGRESSION_NOV_10, order: 1, ...over,
    };
}

/** Molten Core, 2 of 10 down by default. */
export function buildProgressionInstance(over: Partial<WowProgressionInstanceDto> = {}): WowProgressionInstanceDto {
    return {
        key: 'j:741', name: 'Molten Core', bossesDown: 2, bossTotal: 10, showDifficulty: false,
        latestKill: { name: 'Magmadar', at: PROGRESSION_NOV_6 },
        bosses: [buildProgressionBoss('Lucifron', { encounterId: 663 }), buildProgressionBoss('Magmadar', { encounterId: 664, order: 2 })],
        ...over,
    };
}

/** A page with the given instances and an empty activity feed. */
export function buildProgressionPage(instances: WowProgressionInstanceDto[] = []): WowGuildProgressionPageDto {
    return {
        progression: { instances, pullCount: instances.length === 0 ? 0 : 12, lastPullAt: instances.length === 0 ? null : PROGRESSION_NOV_10 },
        activity: { entries: [], windowDays: 30 },
    };
}

/** GET → `body` (200), the 403 a non-member gets, or a 500. */
export function guildProgressionGetHandler(body: WowGuildProgressionPageDto | 'forbidden' | 'error') {
    return http.get(GUILD_PROGRESSION_URL, () => {
        if (body === 'forbidden') return HttpResponse.json({ statusCode: 403, message: 'Not a member of this guild' }, { status: 403 });
        if (body === 'error') return HttpResponse.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 });
        return HttpResponse.json(body);
    });
}

export const guildProgressionHandlers = [guildProgressionGetHandler(buildProgressionPage())];
