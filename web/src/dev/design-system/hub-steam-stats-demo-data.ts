/**
 * ROK-1953 — sample `/hubs/:id/steam-stats` response for the /dev/design-system
 * hub-widgets demo: the Achievement race card as viewer B sees it, with one
 * other member's hidden unlock masked (design-system §4.27, Core Steam cards).
 */
import type { SteamHubStatsResponse } from '@raid-ledger/contract';

const AT = '2026-10-24T20:00:00.000Z';

export const DEMO_STEAM_STATS: SteamHubStatsResponse = {
    available: true, appId: 1086940, totalAchievements: 54, viewer: { status: 'unlinked' },
    members: [
        { userId: 1, displayName: "Astarion's Biggest Fan", avatarUrl: null, status: 'ok', unlockedCount: 31, playtimeMinutes: 17280, fetchedAt: AT },
        { userId: 2, displayName: 'Karlach Tav', avatarUrl: null, status: 'ok', unlockedCount: 24, playtimeMinutes: 24720, fetchedAt: AT },
        { userId: 3, displayName: 'Shadowheart', avatarUrl: null, status: 'ok', unlockedCount: 9, playtimeMinutes: 2220, fetchedAt: AT },
        { userId: 4, displayName: 'Gale', avatarUrl: null, status: 'unlinked', unlockedCount: null, playtimeMinutes: null, fetchedAt: null },
    ],
    recentUnlocks: [
        { userId: 1, unlockedAt: AT, achievement: { masked: true, globalPct: 3.2 } },
        { userId: 2, unlockedAt: AT, achievement: { masked: false, apiName: 'JACK', name: 'Jack-of-all-Trades', description: null, hidden: false, globalPct: 3.2 } },
        { userId: 3, unlockedAt: AT, achievement: { masked: false, apiName: 'ACT1', name: 'Descent From Avernus', description: null, hidden: false, globalPct: 89 } },
    ],
    rarestUnlock: { userId: 1, unlockedAt: AT, achievement: { masked: true, globalPct: 3.2 } },
    refreshedAt: null,
};
