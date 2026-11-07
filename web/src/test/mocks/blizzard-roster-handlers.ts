/**
 * ROK-1928 — MSW handlers for a WoW: Forever guild hub's Blizzard roster
 * routes (GET / PATCH slug, POST sync). Not registered globally: specs install
 * them with `server.use(...blizzardRosterHandlers(view))` and read the calls.
 */
import { http, HttpResponse } from 'msw';
import type { GuildBlizzardRosterView } from '@raid-ledger/contract';

const API = 'http://localhost:3000';
export const BLIZZARD_ROSTER_URL = `${API}/plugins/wow/guilds/:id/blizzard-roster`;

/** Every request the handlers saw, as `METHOD /path`, plus PATCH bodies. */
export const blizzardRosterCalls: string[] = [];
export const blizzardRosterBodies: unknown[] = [];

/** A roster view; `overrides` win. Defaults to "never synced, no slug". */
export function buildBlizzardRosterView(overrides: Partial<GuildBlizzardRosterView> = {}): GuildBlizzardRosterView {
    return { guildSlug: null, status: null, syncedAt: null, suggestedSlug: 'ye-olde-guild', ...overrides };
}

function record(request: Request): void {
    blizzardRosterCalls.push(`${request.method} ${new URL(request.url).pathname}`);
}

/** GET returns `view`; PATCH echoes the slug into a summary; POST sync reports `ok`. */
export function blizzardRosterHandlers(view: GuildBlizzardRosterView) {
    return [
        http.get(BLIZZARD_ROSTER_URL, ({ request }) => { record(request); return HttpResponse.json(view); }),
        http.patch(BLIZZARD_ROSTER_URL, async ({ request }) => {
            record(request);
            const body: unknown = await request.json();
            blizzardRosterBodies.push(body);
            return HttpResponse.json({ blizzardRoster: { guildSlug: view.guildSlug, status: null, syncedAt: null } });
        }),
        http.post(`${BLIZZARD_ROSTER_URL}/sync`, ({ request }) => {
            record(request);
            return HttpResponse.json({ status: 'ok', syncedAt: new Date().toISOString(), members: 4 });
        }),
    ];
}

/** Clear the call log between specs. */
export function resetBlizzardRosterCalls(): void {
    blizzardRosterCalls.length = 0;
    blizzardRosterBodies.length = 0;
}
