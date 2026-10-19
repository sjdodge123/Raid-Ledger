/**
 * ROK-1836 — TanStack Query hooks over the Valheim armory read client.
 * Claim / owner mutations arrive with L4 and invalidate `valheimArmoryKeys.all`.
 */
import { useEffect, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ValheimCharacterDetail, ValheimCharacterSummary } from '@raid-ledger/contract';
import { fetchWithAuth } from '../../../lib/api/fetch-api';
import {
    fetchValheimCharacter, fetchValheimCharacters, isNotFoundError, valheimArmoryKeys, valheimBlobPath,
} from '../lib/valheim-armory-api';

/** One page of a server's characters; idle until a server id is known. */
export function useValheimCharacters(serverId: number | null, page = 1): UseQueryResult<ValheimCharacterSummary[]> {
    return useQuery({
        queryKey: valheimArmoryKeys.list(serverId ?? 0, page),
        queryFn: () => fetchValheimCharacters(serverId ?? 0, page),
        enabled: serverId !== null && serverId > 0,
        staleTime: 30_000,
    });
}

/** One character sheet. A 404 is final — no retry loop on a dead link. */
export function useValheimCharacter(id: number | null): UseQueryResult<ValheimCharacterDetail> {
    return useQuery({
        queryKey: valheimArmoryKeys.detail(id ?? 0),
        queryFn: () => fetchValheimCharacter(id ?? 0),
        enabled: id !== null && id > 0,
        staleTime: 30_000,
        retry: (count, error) => !isNotFoundError(error) && count < 2,
    });
}

/**
 * An object URL for a member blob (atlas / file icon), fetched with the
 * bearer token. Null while loading, when `sha256` is null, or on any failure
 * — callers fall back to the initials tile (D7). The URL is revoked on change.
 */
export function useValheimBlobUrl(serverId: number, sha256: string | null): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (sha256 === null) return undefined;
        let objectUrl: string | null = null;
        let live = true;
        void loadBlob(serverId, sha256).then((blob) => {
            if (!live || blob === null) return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
        });
        return () => {
            live = false;
            if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [serverId, sha256]);
    return url;
}

async function loadBlob(serverId: number, sha256: string): Promise<Blob | null> {
    try {
        const res = await fetchWithAuth(valheimBlobPath(serverId, sha256));
        return res.ok ? await res.blob() : null;
    } catch {
        return null;
    }
}
