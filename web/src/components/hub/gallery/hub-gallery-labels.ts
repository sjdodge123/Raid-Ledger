/** ROK-1942 — Gallery copy shared by the Overview tile and the L4 viewer. */
import type { HubMediaItem, HubMediaKind } from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';

export const HUB_MEDIA_KIND_LABEL: Record<HubMediaKind, string> = {
    death: 'Death',
    screenshot: 'Screenshot',
    image: 'Picture',
    /** ROK-1965 — member uploads read as screenshots (their chip). */
    upload: 'Screenshot',
    /** ROK-1959 D-7 — a game-save picture (its own "Saves" chip). */
    save: 'Save',
};

/** The tile's accessible name; `now` is injectable for specs. */
export function hubGalleryTileLabel(item: HubMediaItem, now: number = Date.now()): string {
    const who = item.authorName === null ? '' : ` — ${item.authorName}`;
    const hidden = item.hidden ? ' (hidden)' : '';
    return `${HUB_MEDIA_KIND_LABEL[item.kind]}${who}${hidden}, ${syncedAgo(item.capturedAt, now)}. Open picture`;
}
