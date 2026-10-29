/**
 * ROK-1942 — an object URL for a hub media file (`thumbPath` / `fullPath`, API
 * paths behind the bearer token): the core twin of `useValheimBlobUrl`. Null
 * while loading, for a null path, or on any failure (the caller draws its
 * fallback). The bytes are immutable per path, so they are cached forever;
 * each consumer's object URL is revoked on change / unmount.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api/fetch-api';

async function fetchMediaBlob(path: string): Promise<Blob> {
    const res = await fetchWithAuth(path);
    if (!res.ok) throw new Error(`hub media ${res.status}`);
    return res.blob();
}

export function useHubMediaImageUrl(path: string | null): string | null {
    const { data } = useQuery({
        queryKey: ['hub-media', 'file', path ?? ''],
        queryFn: () => fetchMediaBlob(path ?? ''),
        enabled: path !== null,
        staleTime: Infinity,
        retry: false,
    });
    const blob = path === null ? null : (data ?? null);
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        // jsdom lacks createObjectURL → the caller's fallback.
        if (blob === null || typeof URL.createObjectURL !== 'function') return undefined;
        const objectUrl = URL.createObjectURL(blob);
        // Lifetime must match this effect (StrictMode-safe revoke), as in useValheimBlobUrl.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUrl(objectUrl);
        return () => {
            URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [blob]);
    return url;
}
