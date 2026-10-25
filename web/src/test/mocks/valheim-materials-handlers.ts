/**
 * ROK-1853 — MSW fixtures for the hub Materials routes (shared + personal
 * totals, the chest list, one chest). Not in the default handler list: specs
 * `server.use()` them. A separate file: `valheim-armory-handlers.ts` is near
 * the 300-line cap.
 */
import { http, HttpResponse } from 'msw';
import type {
    ValheimContainerDetail,
    ValheimContainerListResponse,
    ValheimContainerSummary,
    ValheimMaterialsBase,
    ValheimMaterialsResponse,
} from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
const SERVER = `${API_BASE}/plugins/valheim/armory/servers/:serverId`;
export const VALHEIM_MATERIALS_URL = `${SERVER}/materials`;
export const VALHEIM_CONTAINERS_URL = `${SERVER}/containers`;
export const VALHEIM_CONTAINER_URL = `${SERVER}/containers/:key`;

export const materialsCatalogue: ValheimMaterialsResponse['items'] = {
    Wood: { name: 'Wood', category: 'Material', icon: null },
    Stone: { name: 'Stone', category: 'Material', icon: null },
    SwordIron: { name: 'Iron sword', category: 'Weapon', icon: null },
    Coins: { name: 'Coins', category: 'Valuable', icon: null },
    piece_chest_wood: { name: 'Wood chest', category: 'Furniture', icon: null },
    Cart: { name: 'Cart', category: 'Vehicle', icon: null },
};

/** `minutesAgo` sets `capturedAt` relative to the real clock. */
export function materialsFixture(
    over: Partial<ValheimMaterialsResponse> = {},
    minutesAgo = 7,
): ValheimMaterialsResponse {
    return {
        worldUid: 'world-1',
        capturedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        gameVersion: '0.220.5',
        catalogFallback: false,
        shared: {
            totals: [
                { prefab: 'Wood', quality: 1, total: 1240, chests: 2 },
                { prefab: 'Stone', quality: 1, total: 40, chests: 1 },
                { prefab: 'SwordIron', quality: 1, total: 1, chests: 1 },
                { prefab: 'SwordIron', quality: 2, total: 3, chests: 1 },
            ],
            chestCount: 2,
            warnings: { unreadable: 0, omittedEntries: 0, omittedShared: 0 },
        },
        personal: null,
        items: materialsCatalogue,
        atlas: null,
        ...over,
    };
}

export const materialsEmpty: ValheimMaterialsResponse = {
    ...materialsFixture(),
    worldUid: null,
    capturedAt: null,
    gameVersion: null,
    shared: {
        totals: [],
        chestCount: 0,
        warnings: { unreadable: 0, omittedEntries: 0, omittedShared: 0 },
    },
};

export const chestShared: ValheimContainerSummary = {
    key: 'A'.repeat(22),
    prefab: 'piece_chest_wood',
    x: 120,
    y: 30,
    z: -340,
    privacy: 'shared',
    vehicle: false,
    slots: 10,
    usedSlots: 2,
    unreadable: false,
    omittedEntries: 0,
    stackCount: 2,
};
export const chestCart: ValheimContainerSummary = {
    ...chestShared,
    key: 'B'.repeat(22),
    prefab: 'Cart',
    x: -5,
    z: 8,
    vehicle: true,
    usedSlots: 1,
    stackCount: 1,
};

export function containersFixture(
    containers = [chestShared, chestCart],
): ValheimContainerListResponse {
    return {
        worldUid: 'world-1',
        capturedAt: materialsFixture().capturedAt,
        containers,
        items: materialsCatalogue,
        atlas: null,
    };
}

export const chestSharedDetail: ValheimContainerDetail = {
    ...chestShared,
    stacks: [
        { prefab: 'Wood', quality: 1, stack: 50 },
        { prefab: 'SwordIron', quality: 2, stack: 1 },
    ],
};

/** ROK-1859: two bases — A (home, the shared chest) and C (far, Stone). */
export const BASE_A = 'A'.repeat(22);
export const BASE_C = 'C'.repeat(22);
export const basesFixture: ValheimMaterialsBase[] = [
    {
        key: BASE_A,
        x: 3,
        z: 53,
        chestCount: 5,
        vehicleCount: 0,
        totals: [
            { prefab: 'Wood', quality: 1, total: 1200, chests: 1 },
            { prefab: 'SwordIron', quality: 2, total: 3, chests: 1 },
        ],
    },
    {
        key: BASE_C,
        x: 610,
        z: -420,
        chestCount: 1,
        vehicleCount: 0,
        totals: [{ prefab: 'Stone', quality: 1, total: 40, chests: 1 }],
    },
];
export const chestFar: ValheimContainerSummary = {
    ...chestShared,
    key: BASE_C,
    x: 604,
    z: -418,
    base: BASE_C,
    index: 1,
};
/** The chest list with `base` + `index` on every row (the cart is unbased). */
export const containersWithBases = (): ValheimContainerListResponse =>
    containersFixture([
        { ...chestShared, base: BASE_A, index: 2 },
        { ...chestCart, base: null, index: 1 },
        chestFar,
    ]);
/** The viewer's personal chests split by base: one at A, one away from bases. */
export const personalWithBases: NonNullable<
    ValheimMaterialsResponse['personal']
> = {
    totals: [
        { prefab: 'Coins', quality: 1, total: 99, chests: 1 },
        { prefab: 'Wood', quality: 1, total: 5, chests: 1 },
    ],
    chestCount: 2,
    omittedPrivate: null,
    byBase: [
        {
            base: BASE_A,
            chestCount: 1,
            totals: [{ prefab: 'Coins', quality: 1, total: 99, chests: 1 }],
        },
        {
            base: null,
            chestCount: 1,
            totals: [{ prefab: 'Wood', quality: 1, total: 5, chests: 1 }],
        },
    ],
};

/** Records each request's query string in `hits` (newest last). */
export function valheimMaterialsHandler(
    body: ValheimMaterialsResponse | ((url: URL) => ValheimMaterialsResponse),
    hits: string[] = [],
) {
    return http.get(VALHEIM_MATERIALS_URL, ({ request }) => {
        const url = new URL(request.url);
        hits.push(url.search);
        return HttpResponse.json(typeof body === 'function' ? body(url) : body);
    });
}

export function valheimContainersHandler(
    body = containersFixture(),
    hits: string[] = [],
) {
    return http.get(VALHEIM_CONTAINERS_URL, ({ request }) => {
        hits.push(new URL(request.url).search);
        return HttpResponse.json(body);
    });
}

export function valheimContainerHandler(detail = chestSharedDetail) {
    return http.get(VALHEIM_CONTAINER_URL, ({ params }) =>
        params.key === detail.key
            ? HttpResponse.json(detail)
            : HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    );
}
