/**
 * ROK-1905 — the ONE MSW fixture + handler module for the WoW: Forever hub
 * widgets (class/level ROK-1921, roles ROK-1922, professions ROK-1923, dungeon
 * quests ROK-1924). Not registered globally: specs install handlers with
 * `server.use(...)`.
 */
import { http, HttpResponse } from 'msw';
import type {
    CharacterDto, EventQuestReadinessDto, GuildEventCardDto, GuildRaidsDto, WowRosterInsightsDto,
} from '@raid-ledger/contract';
import { emptyGuildRaids, GUILD_RAIDS_URL } from '../mocks/guild-raids-handlers';

const API = 'http://localhost:3000';

export const ROSTER_INSIGHTS_URL = `${API}/plugins/wow/guilds/:id/roster-insights`;

/** Stable uuids for linked roster rows; `mine` is the viewer's own character. */
export const MOCK_CHAR_IDS = {
    thrall: '11111111-1111-4111-8111-111111111111',
    jaina: '22222222-2222-4222-8222-222222222222',
    mine: '33333333-3333-4333-8333-333333333333',
} as const;

/** An ISO timestamp `days` before now. */
export function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ── roster-insights payloads ────────────────────────────────────────────────

type RoleCounts = WowRosterInsightsDto['roles']['dungeon'];

const NO_ROLES: RoleCounts = { tank: 0, healer: 0, dps: 0, unknown: 0 };

/** No classes, levels or roles, fed by a LedgerLink import `asOf`; `overrides` win. */
export function createBareRosterInsights(
    overrides: Partial<WowRosterInsightsDto> = {},
    asOf: string | null = new Date().toISOString(),
): WowRosterInsightsDto {
    return {
        classes: [],
        levels: { buckets: [], max: null, median: null, atCap: 0 },
        roles: { dungeon: NO_ROLES, raid: NO_ROLES },
        freshness: { roster: { source: 'addon', asOf }, characters: { addon: 0, blizzard: 0, none: 0 } },
        ...overrides,
    };
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

/** An empty roster: no classes, no buckets, no import yet. */
export function createEmptyRosterInsights(): WowRosterInsightsDto {
    return createMockRosterInsights({
        classes: [], levels: { buckets: [], max: null, median: null, atCap: 0 },
        freshness: { roster: null, characters: { addon: 0, blizzard: 0, none: 0 } },
    });
}

/** A payload with the given role bands and roster freshness (Role breakdown). */
export function rosterInsightsWithRoles(
    roles: { dungeon?: RoleCounts; raid?: RoleCounts } = {},
    asOf: string | null = new Date().toISOString(),
): WowRosterInsightsDto {
    return createBareRosterInsights({ roles: { dungeon: roles.dungeon ?? NO_ROLES, raid: roles.raid ?? NO_ROLES } }, asOf);
}

/** A guild with a few dungeon-ready and raid-ready members. */
export const ROLES_FIXTURE: WowRosterInsightsDto = rosterInsightsWithRoles({
    dungeon: { tank: 2, healer: 3, dps: 9, unknown: 1 },
    raid: { tank: 1, healer: 2, dps: 5, unknown: 0 },
});

const PROFESSIONS_BASE = createBareRosterInsights({
    freshness: { roster: { source: 'addon', asOf: '2026-10-22T10:00:00.000Z' }, characters: { addon: 2, blizzard: 0, none: 3 } },
});

/** Two professions: Alchemy (two members, one with an unknown skill) and Mining. */
export const PROFESSIONS_FIXTURE: WowRosterInsightsDto = {
    ...PROFESSIONS_BASE,
    professions: [
        {
            name: 'Alchemy',
            members: [
                { characterId: MOCK_CHAR_IDS.thrall, name: 'Brewa', skill: 225, maxSkill: 300, source: 'manual' },
                { characterId: MOCK_CHAR_IDS.jaina, name: 'Mixer', skill: null, maxSkill: null, source: 'addon' },
            ],
        },
        { name: 'Mining', members: [{ characterId: MOCK_CHAR_IDS.jaina, name: 'Mixer', skill: 150, maxSkill: 150, source: 'addon' }] },
    ],
};

/** A member viewer on a guild where nobody has set professions. */
export const NO_PROFESSIONS_FIXTURE: WowRosterInsightsDto = { ...PROFESSIONS_BASE, professions: [] };

/** A visitor's payload: the members-only `professions` key is omitted. */
export const VISITOR_FIXTURE: WowRosterInsightsDto = { ...PROFESSIONS_BASE };

interface RosterInsightsHandlerOptions {
    /** The payload for the full roster; defaults to `createMockRosterInsights()`. */
    all?: WowRosterInsightsDto;
    /** The payload for `?mainsOnly=true`; defaults to `all`. */
    mains?: WowRosterInsightsDto;
    /** Sees every request URL (to assert the query string). */
    onRequest?: (url: URL) => void;
}

/** The roster-insights handler; serves `mains` when `?mainsOnly=true`. */
export function rosterInsightsHandler(opts: RosterInsightsHandlerOptions = {}): ReturnType<typeof http.get> {
    const all = opts.all ?? createMockRosterInsights();
    return http.get(ROSTER_INSIGHTS_URL, ({ request }) => {
        const url = new URL(request.url);
        opts.onRequest?.(url);
        const mainsOnly = url.searchParams.get('mainsOnly') === 'true';
        return HttpResponse.json(mainsOnly ? (opts.mains ?? all) : all);
    });
}

// ── the viewer's characters (professions empty state) ───────────────────────

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
export function myCharactersHandler(chars: readonly CharacterDto[]): ReturnType<typeof http.get> {
    return http.get(`${API}/users/me/characters`, () => HttpResponse.json({ data: chars, meta: { total: chars.length } }));
}

// ── dungeon quests: guild /raids cards + roster-wide quest readiness ────────
export const QUEST_READINESS_URL = 'http://localhost:3000/plugins/wow-classic/events/:eventId/quest-readiness';

export const ALDRIC_CHARACTER_ID = '0b9a2f7e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';

/** An upcoming guild event card; `instances` = its planned dungeons. */
export function contentEvent(id: number, startTime: string, instances: { id: number; name: string }[] = [{ id: 48, name: 'Blackfathom Deeps' }]): GuildEventCardDto {
    return {
        id, title: `Event ${id}`, startTime, endTime: startTime, signupCount: 2, needed: 5,
        viewerStatus: 'signed_up', contentInstances: instances,
    };
}

/** A `/raids` payload with these upcoming events. */
export function raidsWith(upcoming: GuildEventCardDto[]): GuildRaidsDto {
    return { ...emptyGuildRaids, upcoming };
}

/** Two quests × two signups covering every state and one unmet prereq. */
export const readinessFixture: EventQuestReadinessDto = {
    quests: [
        { questId: 909, title: 'Knowledge in the Deeps', instanceId: 48 },
        { questId: 1199, title: 'Twilight Falls', instanceId: 48 },
    ],
    signups: [
        { userId: 1, characterId: ALDRIC_CHARACTER_ID, name: 'Aldric', perQuest: [
            { questId: 909, state: 'done', prereqsMet: true, source: null },
            { questId: 1199, state: 'have', prereqsMet: true, source: null },
        ] },
        { userId: 2, characterId: null, name: 'Bryn', perQuest: [
            { questId: 909, state: 'missing', prereqsMet: false, source: null },
            { questId: 1199, state: 'unknown', prereqsMet: null, source: null },
        ] },
    ],
};

/** The pre-launch shape: the event has content, the dataset has no quests. */
export const emptyDatasetReadiness: EventQuestReadinessDto = { quests: [], signups: readinessFixture.signups.map((s) => ({ ...s, perQuest: [] })) };

export type ReadinessReply = EventQuestReadinessDto | 403 | 404;

/** Quest readiness per event id; an event not in the map gets a 404. */
export function questReadinessHandler(byEvent: Record<number, ReadinessReply>): ReturnType<typeof http.get> {
    return http.get(QUEST_READINESS_URL, ({ params }) => {
        const reply = byEvent[Number(params['eventId'])] ?? 404;
        if (typeof reply === 'number') return HttpResponse.json({ message: 'nope' }, { status: reply });
        return HttpResponse.json(reply);
    });
}

/** The guild `/raids` read answering with these upcoming events. */
export function guildRaidsHandler(upcoming: GuildEventCardDto[]): ReturnType<typeof http.get> {
    return http.get(GUILD_RAIDS_URL, () => HttpResponse.json(raidsWith(upcoming)));
}
