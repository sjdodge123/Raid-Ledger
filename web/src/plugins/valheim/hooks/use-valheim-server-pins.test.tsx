import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import type { ReactNode } from 'react';
import type { ValheimServerPinsResponse } from '@raid-ledger/contract';
import { httpStatusOf } from '../../../lib/api/api-error';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useValheimServerPins, valheimServerPinsPath, type ServerPinsArgs } from './use-valheim-server-pins';

const URL_ = 'http://localhost:3000/plugins/valheim/armory/servers/3/pins';
const WORLD = '1234567890';
const BODY: ValheimServerPinsResponse = {
    worldUid: WORLD,
    pins: [{ x: 1, z: 2, type: 'Bed', label: 'Base', checked: false, characterId: 11, characterName: 'Ragnhild' }],
    truncated: false,
};
const args = (over: Partial<ServerPinsArgs> = {}): ServerPinsArgs =>
    ({ serverId: 3, worldUid: WORLD, players: 'all', types: undefined, ...over });

const wrapperFor = () => {
    const client = createTestQueryClient();
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
};

/** Records each request's query string and answers `body` (or `status` with the hub 404 body). */
function recordingHandler(seen: URLSearchParams[], body: JsonBodyType = BODY, status = 200) {
    return http.get(URL_, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return status === 200
            ? HttpResponse.json(body)
            : HttpResponse.json({ statusCode: status, message: 'Hub not found' }, { status });
    });
}

describe('valheimServerPinsPath (D4)', () => {
    it('omits players for everyone and types for every type', () => {
        expect(valheimServerPinsPath(args())).toBe(`/plugins/valheim/armory/servers/3/pins?worldUid=${WORLD}`);
    });

    it('sends chosen ids and raw types as comma lists', () => {
        const path = valheimServerPinsPath(args({ players: [11, 12], types: ['Death', 'Icon4'] }));
        const query = new URLSearchParams(path.split('?')[1] ?? '');
        expect([query.get('players'), query.get('types')]).toEqual(['11,12', 'Death,Icon4']);
    });
});

describe('useValheimServerPins (S19)', () => {
    it('one request with the world, parsed with the contract schema', async () => {
        const seen: URLSearchParams[] = [];
        server.use(recordingHandler(seen));
        const { result } = renderHook(() => useValheimServerPins(args({ types: ['Death'] }), true),
            { wrapper: wrapperFor() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(BODY);
        expect(seen.map((q) => [q.get('worldUid'), q.get('players'), q.get('types')]))
            .toEqual([[WORLD, null, 'Death']]);
    });

    it('fetches nothing while disabled or without a server', () => {
        const seen: URLSearchParams[] = [];
        server.use(recordingHandler(seen));
        const off = renderHook(() => useValheimServerPins(args(), false), { wrapper: wrapperFor() });
        const noServer = renderHook(() => useValheimServerPins(args({ serverId: 0 }), true), { wrapper: wrapperFor() });
        // An enabled query is already `fetching` on mount; idle means none was started.
        expect(off.result.current.fetchStatus).toBe('idle');
        expect(noServer.result.current.fetchStatus).toBe('idle');
        expect(seen).toEqual([]);
    });

    it('a visitor 404 is an error with status 404, not retried', async () => {
        const seen: URLSearchParams[] = [];
        server.use(recordingHandler(seen, BODY, 404));
        const { result } = renderHook(() => useValheimServerPins(args(), true), { wrapper: wrapperFor() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(httpStatusOf(result.current.error)).toBe(404);
        expect(seen).toHaveLength(1);
    });

    it('a body off the contract shape is an error, never drawn', async () => {
        server.use(recordingHandler([], { ...BODY, steamId: '7656' }));
        const { result } = renderHook(() => useValheimServerPins(args(), true), { wrapper: wrapperFor() });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.data).toBeUndefined();
    });
});
