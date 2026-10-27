/**
 * ROK-1942 — the Gallery dialog's "See all" grid (approved mockup frame 5):
 * every loaded picture of the current chip filter as the same square tiles
 * the Overview card draws; a tile switches the dialog to viewer mode at its
 * index. Paging ("Load more") lives in the dialog footer.
 */
import type { JSX } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { HubGalleryTile } from './hub-gallery-tile';

export interface HubGalleryGridProps {
    items: readonly HubMediaItem[];
    total: number;
    onOpen: (index: number) => void;
}

export function HubGalleryGrid({ items, total, onOpen }: HubGalleryGridProps): JSX.Element {
    return (
        <div className="flex flex-col gap-3">
            <p className="text-sm text-muted" aria-live="polite">{total === 1 ? '1 picture' : `${total} pictures`}</p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="All pictures" data-testid="hub-gallery-grid">
                {items.map((item, index) => (
                    <li key={item.id} className="min-w-0"><HubGalleryTile item={item} onOpen={() => onOpen(index)} /></li>
                ))}
            </ul>
        </div>
    );
}
