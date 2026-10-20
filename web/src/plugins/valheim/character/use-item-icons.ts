/**
 * ROK-1836 D6 — what an item tile needs to draw its icon. The blob route is
 * bearer-only, so bytes go through `useValheimBlobUrl` (one fetch per page).
 */
import type {
    ValheimCharacterDetail,
    ValheimMapBaseMap,
} from '@raid-ledger/contract';
import { useValheimBlobUrl } from '../hooks/use-valheim-characters';
import type { ValheimItemCatalogue } from './item-icon.helpers';
import { useDecodedImage } from './use-decoded-image';

export interface ItemIconContext {
    serverId: number;
    items: ValheimItemCatalogue;
    atlas: ValheimMapBaseMap | null;
    /** Object URL of the decoded atlas; null while loading, not ready, failed, or undecodable. */
    atlasUrl: string | null;
}

export interface ItemIconSource {
    serverId: number;
    items: ValheimItemCatalogue | undefined;
    atlas: ValheimMapBaseMap | null | undefined;
}

/** ROK-1853 — the same context for any catalogue subset (the Materials tab). */
export function useItemIconsFor({
    serverId,
    items,
    atlas: rawAtlas,
}: ItemIconSource): ItemIconContext {
    const atlas = rawAtlas ?? null;
    const blobUrl = useValheimBlobUrl(
        serverId,
        atlas?.ready ? atlas.sha256 : null,
    );
    const atlasUrl = useDecodedImage(blobUrl);
    return { serverId, items: items ?? {}, atlas, atlasUrl };
}

export function useItemIcons(
    character: ValheimCharacterDetail,
): ItemIconContext {
    return useItemIconsFor({
        serverId: character.pelicanServerId,
        items: character.items,
        atlas: character.atlas,
    });
}
