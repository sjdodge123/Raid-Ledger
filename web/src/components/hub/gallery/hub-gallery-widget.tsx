/**
 * ROK-1942 — the hub Overview "Gallery" card body (core): the All · Deaths ·
 * Screenshots chips, a strip of 8 square thumbnails ≥1024px (6 below), newest
 * first, and a footnote. ROK-1965 D15: an empty hub shows every member the
 * §4.5 one-liner; "Add picture" lives in the card header (`hub-gallery-see-all`).
 * A tile opens the L4 dialog in viewer mode via `hub-gallery-store.ts`; the
 * dialog itself is mounted by the hub Overview (ROK-1941 D14,
 * `hub-gallery-dialog-mount.tsx`).
 * Default export so the registration can `React.lazy` it.
 */
import type { JSX } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import {
    HUB_GALLERY_STRIP_LIMIT,
    HUB_GALLERY_STRIP_LIMIT_PHONE,
    hubMediaStripQuery,
} from '../../../lib/hub-media-query';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { HubGalleryChips } from './hub-gallery-chips';
import { useHubGalleryStore } from './hub-gallery-store';
import { useHubGalleryCardFilter } from './use-hub-gallery-card-filter';
import { HubGalleryTile } from './hub-gallery-tile';

export const GALLERY_EMPTY_HINT = 'No pictures yet. Add the first one.';

function GalleryStrip({ items, onOpen }: {
    items: readonly HubMediaItem[];
    onOpen: (item: HubMediaItem, index: number, trigger: HTMLButtonElement) => void;
}): JSX.Element {
    return (
        <ul className="grid grid-cols-3 gap-2 lg:grid-cols-4" aria-label="Recent pictures">
            {items.map((item, index) => (
                <li key={item.id} className="min-w-0"><HubGalleryTile item={item} onOpen={(el) => onOpen(item, index, el)} /></li>
            ))}
        </ul>
    );
}

export default function HubGalleryWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const setFilter = useHubGalleryStore((s) => s.setFilter);
    const openGallery = useHubGalleryStore((s) => s.openGallery);
    const desktop = useMediaQuery(DESKTOP_MQ);
    const { all, filters, filter } = useHubGalleryCardFilter(guildId);
    const shown = useQuery({ ...hubMediaStripQuery(guildId, filter), placeholderData: keepPreviousData });
    if (all.data === undefined) return null;
    if (all.data.total === 0) {
        return <p className="py-8 text-center text-sm text-muted" data-testid="hub-gallery-empty">{GALLERY_EMPTY_HINT}</p>;
    }
    const limit = desktop ? HUB_GALLERY_STRIP_LIMIT : HUB_GALLERY_STRIP_LIMIT_PHONE;
    return (
        <div className="flex flex-col gap-3">
            <HubGalleryChips filters={filters} value={filter} onChange={(f) => setFilter(guildId, f)} />
            <GalleryStrip items={(shown.data?.items ?? []).slice(0, limit)}
                onOpen={(item, index, el) => openGallery({ guildId, mode: 'viewer', filter, index, mediaId: item.id, returnFocus: el })} />
            <p className="text-xs text-muted">Newest first</p>
        </div>
    );
}
