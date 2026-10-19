/**
 * MSW fixtures for the Valheim armory member routes (ROK-1835 read, ROK-1836
 * detail additions). Not in the default handler list: specs `server.use()` them.
 */
import { http, HttpResponse } from 'msw';
import type { ValheimCharacterDetail, ValheimCharacterSummary, ValheimItemStack } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
export const VALHEIM_CHARACTERS_URL = `${API_BASE}/plugins/valheim/armory/characters`;
export const VALHEIM_CHARACTER_URL = `${VALHEIM_CHARACTERS_URL}/:id`;

export const valheimCharacterUnclaimed: ValheimCharacterSummary = {
    id: 11, pelicanServerId: 7, serverName: 'Fixtureheim', name: 'Ragnhild', worldName: 'Midgard',
    claimedBy: null, claimSource: null, capturedAt: '2026-10-19T10:00:00.000Z', gameVersion: '0.220.5',
};

export const valheimCharacterClaimed: ValheimCharacterSummary = {
    ...valheimCharacterUnclaimed, id: 12, name: 'Hrafn',
    claimedBy: { id: 3, username: 'member1', avatar: null }, claimSource: 'manual',
};

export const valheimCharacterAssigned: ValheimCharacterSummary = {
    ...valheimCharacterClaimed, id: 13, name: 'Kestrel', claimSource: 'admin',
};

export function valheimCharacterDetail(over: Partial<ValheimCharacterDetail> = {}): ValheimCharacterDetail {
    return {
        ...valheimCharacterClaimed,
        equipment: [], inventory: { grid: { width: 8, height: 4, extraRows: [] }, items: [] },
        skills: [], trophies: [], maps: [], items: {}, atlas: null, ...over,
    };
}

export function valheimCharactersHandler(rows: ValheimCharacterSummary[]) {
    return http.get(VALHEIM_CHARACTERS_URL, () => HttpResponse.json({ data: rows }));
}

/** `null` answers 404; a plain record lets a spec send an off-contract body. */
export function valheimCharacterHandler(detail: ValheimCharacterDetail | Record<string, unknown> | null) {
    return http.get(VALHEIM_CHARACTER_URL, () => (detail === null
        ? HttpResponse.json({ statusCode: 404, message: 'Character not found' }, { status: 404 })
        : HttpResponse.json(detail)));
}

/* ROK-1836 L3 — catalogue + atlas + EAQS fixtures for the sheet sections. */
export const VALHEIM_ATLAS_SHA = 'c'.repeat(64);
export const VALHEIM_FILE_ICON_SHA = 'd'.repeat(64);
export const valheimBlobUrl = (sha: string, serverId = 7) =>
    `${API_BASE}/plugins/valheim/armory/servers/${serverId}/blobs/${sha}`;

export const valheimAtlas = { sha256: VALHEIM_ATLAS_SHA, width: 512, height: 256, ready: true };

export const valheimCatalogue: NonNullable<ValheimCharacterDetail['items']> = {
    SwordIron: { name: 'Iron sword', category: 'Weapon', icon: { kind: 'atlas', x: 64, y: 0, w: 64, h: 64 } },
    HelmetBronze: { name: 'Bronze helmet', category: 'Armor', icon: { kind: 'atlas', x: 0, y: 64, w: 64, h: 64 } },
    Resin: { name: 'Resin', category: 'Material', icon: null },
    TrophyBoar: { name: 'Boar trophy', category: 'Trophy', icon: { kind: 'file', sha256: VALHEIM_FILE_ICON_SHA } },
};

const stack = (prefab: string, over: Partial<ValheimItemStack> = {}): ValheimItemStack => ({
    prefab, stack: 1, quality: 1, variant: 0, durability: null, maxDurability: null, ...over,
});

/** A full sheet: 8×7 EAQS grid (2 equipment rows + 1 quick-slot row), one unknown prefab. */
export function valheimSheetFixture(over: Partial<ValheimCharacterDetail> = {}): ValheimCharacterDetail {
    const sword = stack('SwordIron', { quality: 3, durability: 40, maxDurability: 200 });
    return valheimCharacterDetail({
        equipment: [{ slot: 'rightHand', item: sword }, { slot: 'head', item: stack('HelmetBronze') }],
        inventory: {
            grid: { width: 8, height: 7, extraRows: [
                { y: 4, purpose: 'equipment' }, { y: 5, purpose: 'equipment' }, { y: 6, purpose: 'quickslot' },
            ] },
            items: [
                { x: 0, y: 0, equipped: false, item: stack('Resin', { stack: 30 }) },
                { x: 1, y: 0, equipped: false, item: stack('ModdedAxe') },
                { x: 0, y: 4, equipped: true, item: sword },
            ],
        },
        skills: [
            { id: 'Swords', level: 34.25, accumulator: 0 }, { id: 'Run', level: 41, accumulator: 0 },
            { id: '-1287461328', level: 3.5, accumulator: 0 },
        ],
        trophies: ['TrophyBoar', 'TrophyDeer'],
        items: valheimCatalogue, atlas: valheimAtlas, ...over,
    });
}

/** Serves any blob as 4 PNG-ish bytes; `missing` shas answer 404. */
export function valheimBlobHandler(missing: string[] = []) {
    return http.get(`${API_BASE}/plugins/valheim/armory/servers/:serverId/blobs/:sha`, ({ params }) =>
        (missing.includes(String(params.sha))
            ? new HttpResponse(null, { status: 404 })
            : new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })));
}
