/**
 * ROK-1923 — MSW fixtures for `GET /plugins/wow/guilds/:id/roster-insights`
 * as the Professions widget reads it. Specs pick a payload with `server.use()`.
 * (The Lead may fold this into a shared roster-insights handler file.)
 */
import { http, HttpResponse } from 'msw';
import type { CharacterDto, WowRosterInsightsDto } from '@raid-ledger/contract';

const API = 'http://localhost:3000';

export const PROF_CHAR_A = '11111111-1111-4111-8111-111111111111';
export const PROF_CHAR_B = '22222222-2222-4222-8222-222222222222';
export const MY_CHAR_ID = '33333333-3333-4333-8333-333333333333';

const BASE: Omit<WowRosterInsightsDto, 'professions'> = {
    classes: [],
    levels: { buckets: [], max: null, median: null, atCap: 0 },
    roles: {
        dungeon: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        raid: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    },
    freshness: { roster: { source: 'addon', asOf: '2026-10-22T10:00:00.000Z' }, characters: { addon: 2, blizzard: 0, none: 3 } },
};

/** Two professions: Alchemy (two members, one with an unknown skill) and Mining. */
export const PROFESSIONS_FIXTURE: WowRosterInsightsDto = {
    ...BASE,
    professions: [
        {
            name: 'Alchemy',
            members: [
                { characterId: PROF_CHAR_A, name: 'Brewa', skill: 225, maxSkill: 300, source: 'manual' },
                { characterId: PROF_CHAR_B, name: 'Mixer', skill: null, maxSkill: null, source: 'addon' },
            ],
        },
        { name: 'Mining', members: [{ characterId: PROF_CHAR_B, name: 'Mixer', skill: 150, maxSkill: 150, source: 'addon' }] },
    ],
};

/** A member viewer on a guild where nobody has set professions. */
export const NO_PROFESSIONS_FIXTURE: WowRosterInsightsDto = { ...BASE, professions: [] };

/** A visitor's payload: the members-only `professions` key is omitted. */
export const VISITOR_FIXTURE: WowRosterInsightsDto = { ...BASE };

/** Roster-insights returning `body` for any guild. */
export function rosterInsightsHandler(body: WowRosterInsightsDto) {
    return http.get(`${API}/plugins/wow/guilds/:id/roster-insights`, () => HttpResponse.json(body));
}

/** A minimal schema-valid WoW: Forever character owned by the viewer. */
export function foreverCharacter(id: string, gameId: number, isMain = true): CharacterDto {
    return {
        id, userId: 1, gameId, name: 'Me', realm: null, class: null, spec: null, role: null, roleOverride: null,
        effectiveRole: null, isMain, itemLevel: null, externalId: null, avatarUrl: null, renderUrl: null, level: 20,
        race: null, faction: null, lastSyncedAt: null, profileUrl: null, region: 'us', ruleset: null, gameVariant: null,
        equipment: null, talents: null, professions: null, displayOrder: 0,
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    };
}

/** `/users/me/characters` returning `chars`. */
export function myCharactersHandler(chars: readonly CharacterDto[]) {
    return http.get(`${API}/users/me/characters`, () => HttpResponse.json({ data: chars, meta: { total: chars.length } }));
}
