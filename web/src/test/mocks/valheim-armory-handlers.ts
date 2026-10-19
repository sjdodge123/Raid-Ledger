/**
 * MSW fixtures for the Valheim armory member routes (ROK-1835 read, ROK-1836
 * detail additions). Not in the default handler list: specs `server.use()` them.
 */
import { http, HttpResponse } from 'msw';
import type {
    ValheimCharacterDetail,
    ValheimCharacterSummary,
    ValheimClaimEvent,
    ValheimItemStack,
} from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
export const VALHEIM_CHARACTERS_URL = `${API_BASE}/plugins/valheim/armory/characters`;
export const VALHEIM_CHARACTER_URL = `${VALHEIM_CHARACTERS_URL}/:id`;

export const valheimCharacterUnclaimed: ValheimCharacterSummary = {
    id: 11,
    pelicanServerId: 7,
    serverName: 'Fixtureheim',
    name: 'Ragnhild',
    worldName: 'Midgard',
    claimedBy: null,
    claimSource: null,
    capturedAt: '2026-10-19T10:00:00.000Z',
    gameVersion: '0.220.5',
};

export const valheimCharacterClaimed: ValheimCharacterSummary = {
    ...valheimCharacterUnclaimed,
    id: 12,
    name: 'Hrafn',
    claimedBy: { id: 3, username: 'member1', avatar: null },
    claimSource: 'manual',
};

export const valheimCharacterAssigned: ValheimCharacterSummary = {
    ...valheimCharacterClaimed,
    id: 13,
    name: 'Kestrel',
    claimSource: 'admin',
};

export function valheimCharacterDetail(
    over: Partial<ValheimCharacterDetail> = {},
): ValheimCharacterDetail {
    return {
        ...valheimCharacterClaimed,
        equipment: [],
        inventory: { grid: { width: 8, height: 4, extraRows: [] }, items: [] },
        skills: [],
        trophies: [],
        maps: [],
        items: {},
        atlas: null,
        ...over,
    };
}

export function valheimCharactersHandler(rows: ValheimCharacterSummary[]) {
    return http.get(VALHEIM_CHARACTERS_URL, () =>
        HttpResponse.json({ data: rows }),
    );
}

/** `null` answers 404; a plain record lets a spec send an off-contract body. */
export function valheimCharacterHandler(
    detail: ValheimCharacterDetail | Record<string, unknown> | null,
) {
    return http.get(VALHEIM_CHARACTER_URL, () =>
        detail === null
            ? HttpResponse.json(
                  { statusCode: 404, message: 'Character not found' },
                  { status: 404 },
              )
            : HttpResponse.json(detail),
    );
}

/* ROK-1836 L3 — catalogue + atlas + EAQS fixtures for the sheet sections. */
export const VALHEIM_ATLAS_SHA = 'c'.repeat(64);
export const VALHEIM_FILE_ICON_SHA = 'd'.repeat(64);
export const valheimBlobUrl = (sha: string, serverId = 7) =>
    `${API_BASE}/plugins/valheim/armory/servers/${serverId}/blobs/${sha}`;

export const valheimAtlas = {
    sha256: VALHEIM_ATLAS_SHA,
    width: 512,
    height: 256,
    ready: true,
};

export const valheimCatalogue: NonNullable<ValheimCharacterDetail['items']> = {
    SwordIron: {
        name: 'Iron sword',
        category: 'Weapon',
        icon: { kind: 'atlas', x: 64, y: 0, w: 64, h: 64 },
    },
    HelmetBronze: {
        name: 'Bronze helmet',
        category: 'Armor',
        icon: { kind: 'atlas', x: 0, y: 64, w: 64, h: 64 },
    },
    Resin: { name: 'Resin', category: 'Material', icon: null },
    TrophyBoar: {
        name: 'Boar trophy',
        category: 'Trophy',
        icon: { kind: 'file', sha256: VALHEIM_FILE_ICON_SHA },
    },
};

const stack = (
    prefab: string,
    over: Partial<ValheimItemStack> = {},
): ValheimItemStack => ({
    prefab,
    stack: 1,
    quality: 1,
    variant: 0,
    durability: null,
    maxDurability: null,
    ...over,
});

function sheetInventory(
    sword: ValheimItemStack,
): ValheimCharacterDetail['inventory'] {
    return {
        grid: {
            width: 8,
            height: 7,
            extraRows: [
                { y: 4, purpose: 'equipment' },
                { y: 5, purpose: 'equipment' },
                { y: 6, purpose: 'quickslot' },
            ],
        },
        items: [
            {
                x: 0,
                y: 0,
                equipped: false,
                item: stack('Resin', { stack: 30 }),
            },
            { x: 1, y: 0, equipped: false, item: stack('ModdedAxe') },
            { x: 0, y: 4, equipped: true, item: sword },
        ],
    };
}

/** A full sheet: 8×7 EAQS grid (2 equipment rows + 1 quick-slot row), one unknown prefab. */
export function valheimSheetFixture(
    over: Partial<ValheimCharacterDetail> = {},
): ValheimCharacterDetail {
    const sword = stack('SwordIron', {
        quality: 3,
        durability: 40,
        maxDurability: 200,
    });
    return valheimCharacterDetail({
        equipment: [
            { slot: 'rightHand', item: sword },
            { slot: 'head', item: stack('HelmetBronze') },
        ],
        inventory: sheetInventory(sword),
        skills: [
            { id: 'Swords', level: 34.25, accumulator: 0 },
            { id: 'Run', level: 41, accumulator: 0 },
            { id: '-1287461328', level: 3.5, accumulator: 0 },
        ],
        trophies: ['TrophyBoar', 'TrophyDeer'],
        items: valheimCatalogue,
        atlas: valheimAtlas,
        ...over,
    });
}

/** Serves any blob as 4 PNG-ish bytes; `missing` shas answer 404. */
export function valheimBlobHandler(missing: string[] = []) {
    return http.get(
        `${API_BASE}/plugins/valheim/armory/servers/:serverId/blobs/:sha`,
        ({ params }) =>
            missing.includes(String(params.sha))
                ? new HttpResponse(null, { status: 404 })
                : new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
                      headers: { 'Content-Type': 'image/png' },
                  }),
    );
}

/* ROK-1836 L4a — claim, admin owner and claim-history routes + the member search. */
export const VALHEIM_CLAIM_URL = `${VALHEIM_CHARACTER_URL}/claim`;
export const VALHEIM_OWNER_URL = `${API_BASE}/admin/plugins/valheim/armory/characters/:id/owner`;
export const VALHEIM_CLAIM_EVENTS_URL = `${API_BASE}/admin/plugins/valheim/armory/characters/:id/claim-events`;

/** 201 by default; pass 409 for "someone claimed first". Records the hit ids. */
export function valheimClaimHandler(status = 201, hits: string[] = []) {
    return http.post(VALHEIM_CLAIM_URL, ({ params }) => {
        hits.push(String(params.id));
        return status === 409
            ? HttpResponse.json(
                  { statusCode: 409, message: 'Character already claimed' },
                  { status: 409 },
              )
            : HttpResponse.json({ ok: true }, { status });
    });
}

/** Captures each PUT body into `bodies`. */
export function valheimOwnerHandler(bodies: unknown[]) {
    return http.put(VALHEIM_OWNER_URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true });
    });
}

export const valheimClaimEvents: ValheimClaimEvent[] = [
    {
        id: 1,
        profileId: 12,
        action: 'claim',
        fromUserId: null,
        toUserId: 3,
        actorUserId: 3,
        createdAt: '2026-10-01T10:00:00.000Z',
        toUser: { id: 3, username: 'member1', avatar: null },
        actor: { id: 3, username: 'member1', avatar: null },
    },
    {
        id: 2,
        profileId: 12,
        action: 'admin_unassign',
        fromUserId: 3,
        toUserId: null,
        actorUserId: 1,
        createdAt: '2026-10-10T10:00:00.000Z',
        fromUser: { id: 3, username: 'member1', avatar: null },
        actor: { id: 1, username: 'admin', avatar: null },
    },
    {
        id: 3,
        profileId: 12,
        action: 'admin_assign',
        fromUserId: null,
        toUserId: 3,
        actorUserId: 1,
        createdAt: '2026-10-05T10:00:00.000Z',
        toUser: { id: 3, username: 'member1', avatar: null },
        actor: { id: 1, username: 'admin', avatar: null },
    },
];

export function valheimClaimEventsHandler(
    events: ValheimClaimEvent[] = valheimClaimEvents,
) {
    return http.get(VALHEIM_CLAIM_EVENTS_URL, () =>
        HttpResponse.json({ data: events }),
    );
}

export function valheimMemberSearchHandler() {
    const data = [
        { id: 3, username: 'member1', avatar: null, steamLinked: false },
        { id: 4, username: 'member2', avatar: null, steamLinked: false },
    ];
    return http.get(`${API_BASE}/users`, () =>
        HttpResponse.json({
            data,
            meta: { total: 2, page: 1, limit: 20, hasMore: false },
        }),
    );
}
