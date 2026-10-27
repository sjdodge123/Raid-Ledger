/**
 * ROK-1930 — MSW fixtures for the Valheim hub Deaths route. Not in the default
 * handler list: specs `server.use()` them.
 */
import { http, HttpResponse } from 'msw';
import type { ValheimDeathPicture, ValheimDeathPlayer, ValheimDeathsResponse, ValheimServerPin, ValheimServerPinsResponse } from '@raid-ledger/contract';

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

/** ROK-1941 D13 — one death picture on a bar (hub 5's bytes route, like `hubMediaItem`). */
export function valheimDeathPicture(mediaId: number, hoursAgo = mediaId): ValheimDeathPicture {
    return {
        mediaId,
        thumbPath: `/hubs/5/media/${mediaId}/thumb`,
        capturedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    };
}

/**
 * ROK-1941 — Ragnhild: 3 of 5 pictures served (newest first) → "+2"; Hrafn:
 * his only picture → no "+N"; Left-the-hub: none (both fields absent, D13).
 */
export const valheimDeathsPicturesFixture: ValheimDeathsResponse = {
    players: [
        valheimDeathPlayer({
            name: 'Ragnhild', deaths: 12, characterId: 11,
            pictures: [valheimDeathPicture(41, 24), valheimDeathPicture(40, 30), valheimDeathPicture(38, 50)], pictureCount: 5,
        }),
        valheimDeathPlayer({ name: 'Hrafn', deaths: 6, characterId: 12, pictures: [valheimDeathPicture(39, 72)], pictureCount: 1 }),
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

export const VALHEIM_SERVER_PINS_URL = 'http://localhost:3000/plugins/valheim/armory/servers/:serverId/pins';

/**
 * ROK-1943 — the cross-player pin layer on `worldUid` (400 without one, like
 * the route); `status` ≠ 200 → the hub-not-found body. `seen` records each
 * request's query so specs can assert `players` / `types`.
 */
export function valheimServerPinsHandler(
    pins: ValheimServerPin[], opts: { status?: number; truncated?: boolean; seen?: URLSearchParams[] } = {},
) {
    const { status = 200, truncated = false, seen } = opts;
    return http.get(VALHEIM_SERVER_PINS_URL, ({ request }) => {
        const query = new URL(request.url).searchParams;
        seen?.push(query);
        const worldUid = query.get('worldUid');
        if (status !== 200) return HttpResponse.json({ statusCode: status, message: 'Hub not found' }, { status });
        if (!worldUid) return HttpResponse.json({ statusCode: 400, message: 'worldUid required' }, { status: 400 });
        return HttpResponse.json({ worldUid, pins, truncated } satisfies ValheimServerPinsResponse);
    });
}
