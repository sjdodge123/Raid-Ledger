/**
 * ROK-1930 — MSW fixtures for the Valheim hub Deaths route. Not in the default
 * handler list: specs `server.use()` them.
 */
import { http, HttpResponse } from 'msw';
import type { ValheimDeathPin, ValheimDeathPinsResponse, ValheimDeathPlayer, ValheimDeathsResponse } from '@raid-ledger/contract';

export const VALHEIM_DEATHS_URL = 'http://localhost:3000/plugins/valheim/armory/servers/:serverId/deaths';

export function valheimDeathPlayer(over: Partial<ValheimDeathPlayer> & Pick<ValheimDeathPlayer, 'name' | 'deaths'>): ValheimDeathPlayer {
    const characterId = over.characterId === undefined ? null : over.characterId;
    return {
        key: characterId === null ? `n${over.name}` : `c${characterId}`,
        lastDeathAt: '2026-10-22T18:00:00.000Z',
        characterId,
        ...over,
    };
}

export const valheimDeathsFixture: ValheimDeathsResponse = {
    players: [
        valheimDeathPlayer({ name: 'Ragnhild', deaths: 12, characterId: 11 }),
        valheimDeathPlayer({ name: 'Hrafn', deaths: 6, characterId: 12 }),
        valheimDeathPlayer({ name: 'Left-the-hub', deaths: 3 }),
    ],
    since: '2026-10-01T12:00:00.000Z',
};

/** Serves `body`, or answers `status` with the hub-not-found body (the visitor 404, D6). */
export function valheimDeathsHandler(body: ValheimDeathsResponse = valheimDeathsFixture, status = 200) {
    return http.get(VALHEIM_DEATHS_URL, () => (status === 200
        ? HttpResponse.json(body)
        : HttpResponse.json({ statusCode: status, message: 'Hub not found' }, { status })));
}

export const VALHEIM_DEATH_PINS_URL = 'http://localhost:3000/plugins/valheim/armory/servers/:serverId/deaths/pins';

/** Every player's Death pins on `worldUid` (400 without one, like the route); `status` ≠ 200 → the visitor 404. */
export function valheimDeathPinsHandler(pins: ValheimDeathPin[], status = 200) {
    return http.get(VALHEIM_DEATH_PINS_URL, ({ request }) => {
        const worldUid = new URL(request.url).searchParams.get('worldUid');
        if (status !== 200) return HttpResponse.json({ statusCode: status, message: 'Hub not found' }, { status });
        if (!worldUid) return HttpResponse.json({ statusCode: 400, message: 'worldUid required' }, { status: 400 });
        return HttpResponse.json({ worldUid, pins } satisfies ValheimDeathPinsResponse);
    });
}
