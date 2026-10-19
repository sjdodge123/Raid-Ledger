/**
 * MSW fixtures for the Valheim armory member routes (ROK-1835 read, ROK-1836
 * detail additions). Not in the default handler list: specs `server.use()` them.
 */
import { http, HttpResponse } from 'msw';
import type { ValheimCharacterDetail, ValheimCharacterSummary } from '@raid-ledger/contract';

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
