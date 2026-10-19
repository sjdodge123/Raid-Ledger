/**
 * ROK-1836 D6 — what an item tile needs to draw its icon. The blob route is
 * bearer-only, so bytes are fetched with auth and shown via an object URL.
 * The fetch is a TanStack query keyed by sha256, so the atlas is fetched ONCE
 * per page even though three sections draw from it.
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
    ValheimCharacterDetail,
    ValheimMapBaseMap,
} from '@raid-ledger/contract';
import { fetchWithAuth } from '../../../lib/api/fetch-api';
import { valheimBlobPath } from '../lib/valheim-armory-api';
import type { ValheimItemCatalogue } from './item-icon.helpers';

export interface ItemIconContext {
    serverId: number;
    items: ValheimItemCatalogue;
    atlas: ValheimMapBaseMap | null;
    /** Object URL of the atlas image; null while loading, not ready, or failed. */
    atlasUrl: string | null;
}

async function fetchBlob(serverId: number, sha256: string): Promise<Blob> {
    const res = await fetchWithAuth(valheimBlobPath(serverId, sha256));
    if (!res.ok) throw new Error(`blob ${res.status}`);
    return res.blob();
}

/** An object URL for a member blob; null on loading / failure / no hash. Revoked on change. */
export function useValheimBlobObjectUrl(
    serverId: number,
    sha256: string | null,
): string | null {
    const query = useQuery({
        queryKey: ['valheim', 'armory', 'blob', serverId, sha256 ?? ''],
        queryFn: () => fetchBlob(serverId, sha256 ?? ''),
        enabled: sha256 !== null,
        staleTime: Infinity,
        retry: false,
    });
    const blob = query.data ?? null;
    const url = useMemo(
        () =>
            blob !== null && typeof URL.createObjectURL === 'function'
                ? URL.createObjectURL(blob)
                : null,
        [blob],
    );
    useEffect(
        () => () => {
            if (url !== null) URL.revokeObjectURL(url);
        },
        [url],
    );
    return url;
}

export function useItemIcons(
    character: ValheimCharacterDetail,
): ItemIconContext {
    const atlas = character.atlas ?? null;
    const atlasUrl = useValheimBlobObjectUrl(
        character.pelicanServerId,
        atlas?.ready ? atlas.sha256 : null,
    );
    return {
        serverId: character.pelicanServerId,
        items: character.items ?? {},
        atlas,
        atlasUrl,
    };
}
