/**
 * ROK-1942 — the Gallery card's header action: "See all (N)" for the card's
 * current chip filter. Opens the L4 dialog in grid mode through the store seam
 * (`hub-gallery-store.ts`). ROK-1965: "Add picture" sits before it ("Add" on a
 * phone) and shows on an empty hub too. Eager (register.ts), so light imports only.
 */
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { hubMediaStripQuery } from '../../../lib/hub-media-query';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { Button } from '../../ui/button';
import { HubGalleryAddPicture } from './hub-gallery-add-picture';
import { useHubGalleryStore } from './hub-gallery-store';
import { useHubGalleryCardFilter } from './use-hub-gallery-card-filter';

export function HubGallerySeeAll({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const { filter } = useHubGalleryCardFilter(guildId);
    const openGallery = useHubGalleryStore((s) => s.openGallery);
    const desktop = useMediaQuery(DESKTOP_MQ);
    const { data } = useQuery(hubMediaStripQuery(guildId, filter));
    if (data === undefined) return null;
    return (
        <span className="flex items-center gap-3">
            <HubGalleryAddPicture guildId={guildId} compact={!desktop} />
            {data.total > 0 && (
                <Button variant="bare" data-testid="hub-gallery-see-all"
                    onClick={(e) => openGallery({ guildId, mode: 'grid', filter, index: 0, returnFocus: e.currentTarget })}
                    className="min-h-[44px] rounded-sm text-sm font-medium text-success hover:underline">
                    See all ({data.total})
                </Button>
            )}
        </span>
    );
}
