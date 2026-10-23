/**
 * ROK-1921 — MSW factory + handler for `GET /plugins/wow/guilds/:id/roster-insights`
 * (the WoW: Forever guild hub widgets). Not registered globally: specs install it
 * with `server.use(rosterInsightsHandler({ ... }))`.
 */
import { http, HttpResponse } from 'msw';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';

const API = 'http://localhost:3000';

/** Stable uuids for linked roster rows. */
export const MOCK_CHAR_IDS = {
    thrall: '11111111-1111-4111-8111-111111111111',
    jaina: '22222222-2222-4222-8222-222222222222',
} as const;

/** An ISO timestamp `days` before now. */
export function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** A small two-class roster with a level histogram, fed by a LedgerLink roster export 3 days ago. */
export function createMockRosterInsights(overrides: Partial<WowRosterInsightsDto> = {}): WowRosterInsightsDto {
    return {
        classes: [
            { class: 'Warrior', count: 3, members: [
                { name: 'Thrall', characterId: MOCK_CHAR_IDS.thrall, level: 60 },
                { name: 'Garrosh', characterId: null, level: 42 },
                { name: 'Varian', characterId: null, level: 18 },
            ] },
            { class: 'Mage', count: 2, members: [
                { name: 'Jaina', characterId: MOCK_CHAR_IDS.jaina, level: 60 },
                { name: 'Khadgar', characterId: null, level: 55 },
            ] },
        ],
        levels: {
            buckets: [{ from: 10, to: 19, count: 1 }, { from: 40, to: 49, count: 1 }, { from: 50, to: 59, count: 1 }, { from: 60, to: 60, count: 2 }],
            max: 60, median: 55, atCap: 2,
        },
        roles: {
            dungeon: { tank: 1, healer: 0, dps: 4, unknown: 0 },
            raid: { tank: 1, healer: 0, dps: 1, unknown: 3 },
        },
        freshness: { roster: { source: 'roster', asOf: daysAgoIso(3) }, characters: { addon: 1, blizzard: 0, none: 4 } },
        ...overrides,
    };
}

/** An empty roster: no classes, no buckets. */
export function createEmptyRosterInsights(): WowRosterInsightsDto {
    return createMockRosterInsights({
        classes: [], levels: { buckets: [], max: null, median: null, atCap: 0 },
        freshness: { roster: null, characters: { addon: 0, blizzard: 0, none: 0 } },
    });
}

interface RosterInsightsHandlerOptions {
    /** The payload for the full roster. */
    all?: WowRosterInsightsDto;
    /** The payload for `?mainsOnly=true`; defaults to `all`. */
    mains?: WowRosterInsightsDto;
    /** Sees every request URL (to assert the query string). */
    onRequest?: (url: URL) => void;
}

/** The roster-insights handler; serves `mains` when `?mainsOnly=true`. */
export function rosterInsightsHandler(opts: RosterInsightsHandlerOptions = {}) {
    const all = opts.all ?? createMockRosterInsights();
    return http.get(`${API}/plugins/wow/guilds/:id/roster-insights`, ({ request }) => {
        const url = new URL(request.url);
        opts.onRequest?.(url);
        const mainsOnly = url.searchParams.get('mainsOnly') === 'true';
        return HttpResponse.json(mainsOnly ? (opts.mains ?? all) : all);
    });
}
