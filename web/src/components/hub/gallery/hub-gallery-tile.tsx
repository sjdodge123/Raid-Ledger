/**
 * ROK-1942 — one square Gallery thumbnail: a `<button>` named for screen
 * readers ("Death — Jasz, 2 h ago. Open picture"), a "Death" badge on death
 * posts, a "Hidden" badge for editors, and a quiet panel while the bytes load
 * or when the file is missing. Tokens only.
 */
import type { JSX } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { useHubMediaImageUrl } from '../../../hooks/use-hub-media-image';
import { FOCUS_RING } from '../../ui/form-classes';
import { hubGalleryTileLabel } from './hub-gallery-labels';

const BADGE = 'absolute rounded-full border bg-surface px-2 text-[11px] leading-5 text-foreground';

export interface HubGalleryTileProps {
    item: HubMediaItem;
    onOpen: (trigger: HTMLButtonElement) => void;
}

export function HubGalleryTile({ item, onOpen }: HubGalleryTileProps): JSX.Element {
    const url = useHubMediaImageUrl(item.thumbPath);
    return (
        <button type="button" aria-label={hubGalleryTileLabel(item)} data-testid="hub-gallery-tile" data-kind={item.kind}
            onClick={(e) => onOpen(e.currentTarget)}
            className={`relative block aspect-square w-full min-w-[44px] overflow-hidden rounded-lg border border-edge bg-panel ${FOCUS_RING}`}>
            {url !== null && <img src={url} alt="" className={`h-full w-full object-cover ${item.hidden ? 'opacity-50' : ''}`} />}
            {item.kind === 'death' && <span aria-hidden="true" className={`${BADGE} bottom-1.5 left-1.5 border-danger`}>Death</span>}
            {item.hidden && <span aria-hidden="true" className={`${BADGE} right-1.5 top-1.5 border-edge-strong`}>Hidden</span>}
        </button>
    );
}
