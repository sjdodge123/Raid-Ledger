/**
 * ROK-1922 — MSW fixture + handler for `GET /plugins/wow/guilds/:id/roster-insights`
 * as the Role breakdown widget reads it. Specs pass their own payload; the
 * default is a guild with a few dungeon-ready and raid-ready members.
 */
import { http, HttpResponse } from 'msw';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';

export const ROSTER_INSIGHTS_URL = 'http://localhost:3000/plugins/wow/guilds/:id/roster-insights';

type RoleCounts = WowRosterInsightsDto['roles']['dungeon'];

const NO_ROLES: RoleCounts = { tank: 0, healer: 0, dps: 0, unknown: 0 };

/** A roster-insights payload with the given role bands and roster freshness. */
export function rosterInsightsWithRoles(
    roles: { dungeon?: RoleCounts; raid?: RoleCounts } = {},
    asOf: string | null = new Date().toISOString(),
): WowRosterInsightsDto {
    return {
        classes: [],
        levels: { buckets: [], max: null, median: null, atCap: 0 },
        roles: { dungeon: roles.dungeon ?? NO_ROLES, raid: roles.raid ?? NO_ROLES },
        freshness: { roster: { source: 'addon', asOf }, characters: { addon: 0, blizzard: 0, none: 0 } },
    };
}

/** Serve `dto` from the roster-insights endpoint (use with `server.use`). */
export function rosterInsightsRolesHandler(dto: WowRosterInsightsDto = rosterInsightsWithRoles({
    dungeon: { tank: 2, healer: 3, dps: 9, unknown: 1 },
    raid: { tank: 1, healer: 2, dps: 5, unknown: 0 },
})): ReturnType<typeof http.get> {
    return http.get(ROSTER_INSIGHTS_URL, () => HttpResponse.json(dto));
}
