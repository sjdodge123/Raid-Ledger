/**
 * ROK-1837 — data hooks for one character map: the meta (shape-locked with
 * `ValheimMapMetaSchema`), the base-map PNG as an object URL (Bearer-only
 * auth rules out `<img src>`, D3; the immutable `Cache-Control` + ETag let the
 * browser cache serve repeats), and a decoded fog layer (D4). Byte-route
 * failures throw {@link MapBytesError} carrying the status and the API's code
 * (`base_map_not_ready`, `no_shared_layer`) so the view can branch on them.
 */
import { useEffect, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
    ValheimMapMetaSchema,
    type ValheimMapBaseMap,
    type ValheimMapFogLayer,
    type ValheimMapMeta,
} from '@raid-ledger/contract';
import { fetchApi, fetchWithAuth } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { decodeFogBitset } from '../map/fog-bitmap';

export class MapBytesError extends Error {
    readonly status: number;
    readonly code: string | null;
    constructor(status: number, code: string | null) {
        super(code ?? `HTTP ${status}`);
        Object.setPrototypeOf(this, MapBytesError.prototype);
        this.name = 'MapBytesError';
        this.status = status;
        this.code = code;
    }
}

export function valheimMapPath(characterId: number, mapId: number): string {
    return `/plugins/valheim/armory/characters/${encodePathSegment(String(characterId))}/maps/${encodePathSegment(String(mapId))}`;
}

const mapKey = (characterId: number | null, mapId: number | null) =>
    ['valheim', 'armory', 'map', characterId, mapId] as const;

async function fetchBytes(path: string): Promise<Response> {
    const res = await fetchWithAuth(path);
    if (res.ok) return res;
    const body = (await res.json().catch(() => null)) as {
        code?: unknown;
        message?: unknown;
    } | null;
    const code =
        typeof body?.code === 'string'
            ? body.code
            : typeof body?.message === 'string'
              ? body.message
              : null;
    throw new MapBytesError(res.status, code);
}

export function useValheimMapMeta(
    characterId: number | null,
    mapId: number | null,
): UseQueryResult<ValheimMapMeta> {
    return useQuery<ValheimMapMeta>({
        queryKey: [...mapKey(characterId, mapId), 'meta'],
        queryFn: () =>
            fetchApi(
                valheimMapPath(characterId ?? 0, mapId ?? 0),
                {},
                ValheimMapMetaSchema,
            ),
        enabled: characterId !== null && mapId !== null,
        retry: false,
    });
}

export interface MapBaseImage {
    url: string | null;
    isLoading: boolean;
    error: Error | null;
}

/** An object URL for `blob`, revoked when the blob changes or on unmount. */
function useObjectUrl(blob: Blob | undefined): string | null {
    const [entry, setEntry] = useState<{ blob: Blob; url: string } | null>(
        null,
    );
    useEffect(() => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        // The object URL is an external resource: create + revoke live in one
        // effect so StrictMode's remount and a new blob each get a fresh URL.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEntry({ blob, url });
        return () => URL.revokeObjectURL(url);
    }, [blob]);
    return entry && entry.blob === blob ? entry.url : null;
}

/** The base map as an object URL; null until `baseMap.ready`. Revoked on change/unmount. */
export function useMapBaseImage(
    characterId: number,
    mapId: number,
    baseMap: ValheimMapBaseMap | null,
): MapBaseImage {
    const ready = baseMap?.ready === true;
    const query = useQuery<Blob>({
        queryKey: [
            ...mapKey(characterId, mapId),
            'base-map',
            baseMap?.sha256 ?? null,
        ],
        queryFn: async () =>
            (
                await fetchBytes(
                    `${valheimMapPath(characterId, mapId)}/base-map`,
                )
            ).blob(),
        enabled: ready,
        retry: false,
        staleTime: Infinity,
    });
    const objectUrl = useObjectUrl(query.data);
    const url = ready ? objectUrl : null;
    return { url, isLoading: ready && query.isPending, error: query.error };
}

export interface FogLayerArgs {
    characterId: number;
    mapId: number;
    layer: ValheimMapFogLayer;
    /** The meta's `grid.textureSize` — the decoded length is checked against it. */
    textureSize: number;
    /** The meta's `capturedAt` — a new snapshot refetches. */
    capturedAt: string;
    enabled?: boolean;
}

/** One fog layer, inflated and length-checked (`Uint8Array` packed bitset). */
export function useFogLayer(args: FogLayerArgs): UseQueryResult<Uint8Array> {
    const {
        characterId,
        mapId,
        layer,
        textureSize,
        capturedAt,
        enabled = true,
    } = args;
    return useQuery<Uint8Array>({
        queryKey: [...mapKey(characterId, mapId), 'fog', layer, capturedAt],
        queryFn: async () => {
            const res = await fetchBytes(
                `${valheimMapPath(characterId, mapId)}/fog?layer=${layer}`,
            );
            return decodeFogBitset(
                new Uint8Array(await res.arrayBuffer()),
                textureSize,
            );
        },
        enabled,
        retry: false,
        staleTime: Infinity,
    });
}
