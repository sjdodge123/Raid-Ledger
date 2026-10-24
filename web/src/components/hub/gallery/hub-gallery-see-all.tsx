/**
 * ROK-1942 — the Gallery card's header action: "See all (N)" for the card's
 * current chip filter. Opens the L4 dialog in grid mode through the store seam
 * (`hub-gallery-store.ts`). Eager (register.ts), so light imports only.
 */
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hubMediaStripQuery } from '../../../lib/hub-media-query';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { FOCUS_RING } from '../../ui/form-classes';
import { useHubGalleryFilter, useHubGalleryStore } from './hub-gallery-store';

export function HubGallerySeeAll({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const filter = useHubGalleryFilter(guildId);
    const openGallery = useHubGalleryStore((s) => s.openGallery);
    const { data } = useQuery(hubMediaStripQuery(guildId, filter));
    if (data === undefined || data.total === 0) return null;
    return (
        <button type="button" data-testid="hub-gallery-see-all"
            onClick={(e) => openGallery({ guildId, mode: 'grid', filter, index: 0, returnFocus: e.currentTarget })}
            className={`inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
            See all ({data.total})
        </button>
    );
}
