import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import type { ValheimMapMeta } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { FogDecodeError } from '../map/fog-bitmap';
import {
    MapBytesError,
    useFogLayer,
    useMapBaseImage,
    useValheimMapMeta,
} from './use-valheim-map';

const MAP_URL =
    'http://localhost:3000/plugins/valheim/armory/characters/5/maps/9';
const SIZE = 64;
const meta: ValheimMapMeta = {
    id: 9,
    worldUid: '1234567890',
    grid: { textureSize: SIZE, pixelSizeMetres: 12 },
    pins: [
        {
            type: 'Bed',
            label: 'Home',
            x: 10,
            z: -20,
            checked: false,
            shared: false,
        },
    ],
    hasSharedExplored: true,
    baseMap: { sha256: 'b'.repeat(64), width: SIZE, height: SIZE, ready: true },
    capturedAt: '2026-10-19T12:00:00.000Z',
};

async function gzip(raw: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
    const stream = new ReadableStream<BufferSource>({
        start(c) {
            c.enqueue(raw);
            c.close();
        },
    });
    return new Response(
        stream.pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
}

const wrapperFor = () => {
    const client = createTestQueryClient();
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
};

const fogArgs = {
    characterId: 5,
    mapId: 9,
    textureSize: SIZE,
    capturedAt: meta.capturedAt,
};

describe('useValheimMapMeta', () => {
    it('parses the meta with the contract schema', async () => {
        server.use(http.get(MAP_URL, () => HttpResponse.json(meta)));
        const { result } = renderHook(() => useValheimMapMeta(5, 9), {
            wrapper: wrapperFor(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.pins[0]?.label).toBe('Home');
    });

    it('rejects a response that drifts from the contract', async () => {
        server.use(
            http.get(MAP_URL, () =>
                HttpResponse.json({ ...meta, grid: { textureSize: 'big' } }),
            ),
        );
        const { result } = renderHook(() => useValheimMapMeta(5, 9), {
            wrapper: wrapperFor(),
        });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.name).toBe('SchemaValidationError');
    });
});

describe('useMapBaseImage', () => {
    const create = vi.fn(() => 'blob:map-1');
    const revoke = vi.fn();
    beforeEach(() => {
        create.mockClear();
        revoke.mockClear();
        Object.assign(URL, {
            createObjectURL: create,
            revokeObjectURL: revoke,
        });
    });
    afterEach(() => {
        Reflect.deleteProperty(URL, 'createObjectURL');
        Reflect.deleteProperty(URL, 'revokeObjectURL');
    });

    it('fetches the PNG into an object URL and revokes it on unmount', async () => {
        server.use(
            http.get(
                `${MAP_URL}/base-map`,
                () =>
                    new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
                        headers: { 'Content-Type': 'image/png' },
                    }),
            ),
        );
        const { result, unmount } = renderHook(
            () => useMapBaseImage(5, 9, meta.baseMap),
            { wrapper: wrapperFor() },
        );
        await waitFor(() => expect(result.current.url).toBe('blob:map-1'));
        expect(create).toHaveBeenCalledTimes(1);
        unmount();
        expect(revoke).toHaveBeenCalledWith('blob:map-1');
    });

    it('does not fetch while the base map is not ready', async () => {
        let hits = 0;
        server.use(
            http.get(`${MAP_URL}/base-map`, () => {
                hits += 1;
                return new HttpResponse(null, { status: 500 });
            }),
        );
        const notReady = {
            sha256: 'b'.repeat(64),
            width: SIZE,
            height: SIZE,
            ready: false,
        };
        const { result } = renderHook(() => useMapBaseImage(5, 9, notReady), {
            wrapper: wrapperFor(),
        });
        expect(result.current).toEqual({
            url: null,
            isLoading: false,
            error: null,
        });
        expect(hits).toBe(0);
    });
});

describe('useFogLayer', () => {
    it('fetches the requested layer and decodes it to the grid length', async () => {
        const raw = new Uint8Array((SIZE * SIZE) / 8).fill(0x0f);
        const body = await gzip(raw);
        const layers: (string | null)[] = [];
        server.use(
            http.get(`${MAP_URL}/fog`, ({ request }) => {
                layers.push(new URL(request.url).searchParams.get('layer'));
                return new HttpResponse(body, {
                    headers: { 'Content-Type': 'application/octet-stream' },
                });
            }),
        );
        const { result } = renderHook(
            () => useFogLayer({ ...fogArgs, layer: 'shared' }),
            { wrapper: wrapperFor() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(layers).toEqual(['shared']);
        expect(Array.from(result.current.data ?? [])).toEqual(Array.from(raw));
    });

    it('surfaces a 404 no_shared_layer as a MapBytesError with its code', async () => {
        server.use(
            http.get(`${MAP_URL}/fog`, () =>
                HttpResponse.json(
                    { statusCode: 404, message: 'no_shared_layer' },
                    { status: 404 },
                ),
            ),
        );
        const { result } = renderHook(
            () => useFogLayer({ ...fogArgs, layer: 'shared' }),
            { wrapper: wrapperFor() },
        );
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeInstanceOf(MapBytesError);
        expect(result.current.error).toMatchObject({
            status: 404,
            code: 'no_shared_layer',
        });
    });

    it('fails with a length error when the layer does not match the grid', async () => {
        const body = await gzip(new Uint8Array(10));
        server.use(http.get(`${MAP_URL}/fog`, () => new HttpResponse(body)));
        const { result } = renderHook(
            () => useFogLayer({ ...fogArgs, layer: 'personal' }),
            { wrapper: wrapperFor() },
        );
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeInstanceOf(FogDecodeError);
        expect(result.current.error).toMatchObject({ reason: 'length' });
    });
});
