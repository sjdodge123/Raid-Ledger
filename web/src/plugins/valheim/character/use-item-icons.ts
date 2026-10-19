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

export function useItemIcons(
    character: ValheimCharacterDetail,
): ItemIconContext {
    const atlas = character.atlas ?? null;
    const blobUrl = useValheimBlobUrl(
        character.pelicanServerId,
        atlas?.ready ? atlas.sha256 : null,
    );
    const atlasUrl = useDecodedImage(blobUrl);
    return {
        serverId: character.pelicanServerId,
        items: character.items ?? {},
        atlas,
        atlasUrl,
    };
}
