/**
 * ROK-1953 — MSW fixtures for `GET /hubs/:guildId/steam-stats`. Not in the
 * default handler list: specs `server.use()` them. `steamStatsResponse()` is
 * the seeded crew as viewer B sees it (A's hidden unlocks arrive masked — the
 * server never sends their names); `status` ≠ 200 → the hub-not-found body.
 */
import { http, HttpResponse } from 'msw';
import type { SteamHubMemberStats, SteamHubStatsResponse, SteamHubUnlock } from '@raid-ledger/contract';

export const HUB_STEAM_STATS_URL = 'http://localhost:3000/hubs/:guildId/steam-stats';

type AvailableStats = Extract<SteamHubStatsResponse, { available: true }>;

export function steamMember(userId: number, over: Partial<SteamHubMemberStats> = {}): SteamHubMemberStats {
    return {
        userId, displayName: `Player${userId}`, avatarUrl: null, status: 'ok',
        unlockedCount: 0, playtimeMinutes: null, fetchedAt: '2026-10-25T04:30:00.000Z', ...over,
    };
}

export function maskedUnlock(userId: number, globalPct: number, unlockedAt: string): SteamHubUnlock {
    return { userId, unlockedAt, achievement: { masked: true, globalPct } };
}

export function namedUnlock(userId: number, name: string, globalPct: number, unlockedAt: string): SteamHubUnlock {
    return {
        userId, unlockedAt,
        achievement: { masked: false, apiName: name.toUpperCase().replace(/\W+/g, '_'), name, description: null, hidden: false, globalPct },
    };
}

/** The seeded crew as B: A 5/6, B 3/6, C private, D unlinked; A's two hidden unlocks masked. */
export function steamStatsResponse(over: Partial<AvailableStats> = {}): AvailableStats {
    const rarest = maskedUnlock(1, 2.7, '2026-10-24T20:00:00.000Z');
    return {
        available: true, appId: 1086940, totalAchievements: 6, viewer: { status: 'ok' },
        members: [
            steamMember(1, { displayName: 'Astarion Fan', unlockedCount: 5, playtimeMinutes: 7260 }),
            steamMember(2, { displayName: 'Karlach Tav', unlockedCount: 3, playtimeMinutes: 2400 }),
            steamMember(3, { displayName: 'Shadowheart', status: 'private', unlockedCount: null, playtimeMinutes: 600 }),
            steamMember(4, { displayName: 'Gale', status: 'unlinked', unlockedCount: null, playtimeMinutes: null, fetchedAt: null }),
        ],
        recentUnlocks: [rarest, namedUnlock(2, 'Descent From Avernus', 89, '2026-10-24T19:00:00.000Z'), maskedUnlock(1, 18.6, '2026-10-24T18:00:00.000Z')],
        rarestUnlock: rarest,
        refreshedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
        ...over,
    };
}

/** Serves `body` for every hub; `status` ≠ 200 → the route's 404 body. */
export function hubSteamStatsHandler(body: SteamHubStatsResponse, status = 200) {
    return http.get(HUB_STEAM_STATS_URL, () => {
        if (status !== 200) return HttpResponse.json({ statusCode: status, message: 'Guild not found' }, { status });
        return HttpResponse.json(body);
    });
}
