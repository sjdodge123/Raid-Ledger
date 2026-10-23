/**
 * ROK-1836 — TanStack Query hooks over the Valheim armory read client.
 * Claim / owner mutations arrive with L4 and invalidate `valheimArmoryKeys.all`.
 */
import { useEffect, useState } from 'react';
import {
    useQueries,
    useQuery,
    type UseQueryResult,
} from '@tanstack/react-query';
import type {
    ValheimCharacterDetail,
    ValheimCharacterSummary,
    ValheimClaimStatusResponse,
} from '@raid-ledger/contract';
import { fetchWithAuth } from '../../../lib/api/fetch-api';
import {
    fetchValheimCharacter,
    fetchValheimCharacters,
    fetchValheimClaimStatus,
    isNotFoundError,
    valheimArmoryKeys,
    valheimBlobPath,
    VALHEIM_CHARACTERS_PAGE_SIZE,
} from '../lib/valheim-armory-api';

/** One page of a server's characters; idle until a server id is known. */
export function useValheimCharacters(
    serverId: number | null,
    page = 1,
): UseQueryResult<ValheimCharacterSummary[]> {
    return useQuery({
        queryKey: valheimArmoryKeys.list(serverId ?? 0, page),
        queryFn: () => fetchValheimCharacters(serverId ?? 0, page),
        enabled: serverId !== null && serverId > 0,
        staleTime: 30_000,
        select: (res) => res.data,
    });
}

/**
 * How many pages to load, reset to 1 whenever the `unclaimed` filter flips
 * (a stored count belongs to the filter it was grown under).
 */
function usePageCount(unclaimed: boolean): [number, () => void] {
    const [state, setState] = useState({ unclaimed, count: 1 });
    const count = state.unclaimed === unclaimed ? state.count : 1;
    return [count, () => setState({ unclaimed, count: count + 1 })];
}

/**
 * Every loaded page of a server's characters, accumulated ("Load more"). The
 * list response's `total` is optional, so `hasMore` = the last loaded page was full.
 * A failed further page keeps the loaded rows; `loadMore` then retries it.
 * `unclaimed` filters server-side (ROK-1933), so every page stays full.
 */
export function useValheimCharacterPages(serverId: number, unclaimed = false) {
    const [pageCount, nextPage] = usePageCount(unclaimed);
    const results = useQueries({
        queries: Array.from({ length: pageCount }, (_, i) => ({
            queryKey: valheimArmoryKeys.list(serverId, i + 1, unclaimed),
            queryFn: () => fetchValheimCharacters(serverId, i + 1, unclaimed),
            enabled: serverId > 0,
            staleTime: 30_000,
        })),
    });
    const first = results[0];
    const last = results[results.length - 1];
    const lastLoaded = [...results].reverse().find((r) => r.data)?.data?.data;
    const moreFailed = pageCount > 1 && last?.isError === true;
    return {
        rows: results.flatMap((r) => r.data?.data ?? []),
        /** The server's row total when the API sends one (newer API only). */
        total: first?.data?.total ?? null,
        isPending: first?.isPending ?? true,
        isError: first?.isError ?? false,
        isSuccess: first?.isSuccess ?? false,
        loadingMore: pageCount > 1 && last?.isFetching === true,
        moreFailed,
        hasMore: (lastLoaded?.length ?? 0) >= VALHEIM_CHARACTERS_PAGE_SIZE,
        loadMore: () => (moreFailed ? void last?.refetch() : nextPage()),
    };
}

/**
 * ROK-1933 — the claim banner's server facts (viewer has a claim, unclaimed
 * count) in one request, whatever the list's size. `invalidateOwnership`
 * refreshes it after every claim, unclaim or reassign.
 */
export function useValheimClaimStatus(
    serverId: number,
): UseQueryResult<ValheimClaimStatusResponse> {
    return useQuery({
        queryKey: valheimArmoryKeys.claimStatus(serverId),
        queryFn: () => fetchValheimClaimStatus(serverId),
        enabled: serverId > 0,
        staleTime: 30_000,
    });
}

/** One character sheet. A 404 is final — no retry loop on a dead link. */
export function useValheimCharacter(
    id: number | null,
): UseQueryResult<ValheimCharacterDetail> {
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
 * bearer token. The bytes are a TanStack query keyed by sha256, so the atlas
 * is fetched ONCE per page however many sections draw from it. Null while
 * loading, when `sha256` is null, or on any failure — callers fall back to the
 * initials tile (D7). Each consumer's object URL is revoked on change/unmount.
 */
export function useValheimBlobUrl(
    serverId: number,
    sha256: string | null,
): string | null {
    const { data } = useQuery({
        queryKey: valheimArmoryKeys.blob(serverId, sha256 ?? ''),
        queryFn: () => fetchBlob(serverId, sha256 ?? ''),
        enabled: sha256 !== null,
        staleTime: Infinity,
        retry: false,
    });
    const blob = sha256 === null ? null : (data ?? null);
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        // jsdom (and very old browsers) lack createObjectURL → initials fallback.
        if (blob === null || typeof URL.createObjectURL !== 'function') {
            return undefined;
        }
        const objectUrl = URL.createObjectURL(blob);
        // The object URL is an external resource whose lifetime must match this
        // effect (StrictMode-safe revoke) — a render-time useMemo would hand out
        // a revoked URL after StrictMode's cleanup/re-run.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUrl(objectUrl);
        return () => {
            URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [blob]);
    return url;
}

async function fetchBlob(serverId: number, sha256: string): Promise<Blob> {
    const res = await fetchWithAuth(valheimBlobPath(serverId, sha256));
    if (!res.ok) throw new Error(`blob ${res.status}`);
    return res.blob();
}
