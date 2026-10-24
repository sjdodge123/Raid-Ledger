/**
 * ROK-1942 — the hub Overview "Gallery" card body (core; Valheim only
 * registers it): the All · Deaths · Screenshots chips, a strip of 8 square
 * thumbnails ≥1024px (6 below), newest first, and a footnote. Members never
 * reach an empty card (`useGalleryWidgetVisible`); editors get the §4.5 hint.
 * A tile opens the L4 dialog in viewer mode via `hub-gallery-store.ts`.
 * Default export so the registration can `React.lazy` it.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import {
    availableFilters,
    HUB_GALLERY_STRIP_LIMIT,
    HUB_GALLERY_STRIP_LIMIT_PHONE,
    hubMediaStripQuery,
} from '../../../lib/hub-media-query';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { HubGalleryChips } from './hub-gallery-chips';
import { useHubGalleryFilter, useHubGalleryStore } from './hub-gallery-store';
import { HubGalleryTile } from './hub-gallery-tile';

const HubGalleryDialogHost = lazy(() => import('./hub-gallery-dialog'));

export const GALLERY_EDITOR_EMPTY_HINT =
    "No pictures yet. Death screenshots from your server's Discord appear here once an admin links the screenshot channel.";

function GalleryStrip({ items, onOpen }: {
    items: readonly HubMediaItem[];
    onOpen: (index: number, trigger: HTMLButtonElement) => void;
}): JSX.Element {
    return (
        <ul className="grid grid-cols-3 gap-2 lg:grid-cols-4" aria-label="Recent pictures">
            {items.map((item, index) => (
                <li key={item.id} className="min-w-0"><HubGalleryTile item={item} onOpen={(el) => onOpen(index, el)} /></li>
            ))}
        </ul>
    );
}

export default function HubGalleryWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const chosen = useHubGalleryFilter(guildId);
    const setFilter = useHubGalleryStore((s) => s.setFilter);
    const openGallery = useHubGalleryStore((s) => s.openGallery);
    const request = useHubGalleryStore((s) => s.request);
    const desktop = useMediaQuery(DESKTOP_MQ);
    const all = useQuery(hubMediaStripQuery(guildId, 'all'));
    const filters = availableFilters(all.data?.kinds ?? []);
    const filter = filters.includes(chosen) ? chosen : 'all';
    const shown = useQuery({ ...hubMediaStripQuery(guildId, filter), placeholderData: keepPreviousData });
    if (all.data === undefined) return null;
    if (all.data.total === 0) {
        if (!page.viewer.canEdit) return null;
        return <p className="py-8 text-center text-sm text-muted" data-testid="hub-gallery-empty">{GALLERY_EDITOR_EMPTY_HINT}</p>;
    }
    const limit = desktop ? HUB_GALLERY_STRIP_LIMIT : HUB_GALLERY_STRIP_LIMIT_PHONE;
    return (
        <div className="flex flex-col gap-3">
            <HubGalleryChips filters={filters} value={filter} onChange={(f) => setFilter(guildId, f)} />
            <GalleryStrip items={(shown.data?.items ?? []).slice(0, limit)}
                onOpen={(index, el) => openGallery({ guildId, mode: 'viewer', filter, index, returnFocus: el })} />
            <p className="text-xs text-muted">From the screenshot channel · newest first</p>
            {request?.guildId === guildId && (
                <Suspense fallback={null}><HubGalleryDialogHost request={request} canEdit={page.viewer.canEdit} /></Suspense>
            )}
        </div>
    );
}
