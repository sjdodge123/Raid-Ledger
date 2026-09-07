import { useLayoutEffect, useRef } from 'react';
import type { EventResponseDto } from '@raid-ledger/contract';
import { IMAGE_CDN_ORIGINS, collectEventImageUrls, ensureOriginHints, originOf, prefetchImages } from '../lib/image-hints';

/**
 * ROK-1482: warm the image CDN connections as soon as the calendar mounts and
 * kick every cover / avatar the cards will paint the moment the /events
 * response is in hand. Layout effects run synchronously after commit and
 * before the browser paints — ahead of the style-recalc pass that would
 * otherwise discover each card's background-image and lazy avatar one at a
 * time. Each URL is prefetched once per mounted calendar.
 */
export function useCalendarImageHints(events: ReadonlyArray<{ resource: EventResponseDto }>): void {
    const seen = useRef<Set<string>>(new Set());
    useLayoutEffect(() => { ensureOriginHints(IMAGE_CDN_ORIGINS); }, []);
    useLayoutEffect(() => {
        if (events.length === 0) return;
        const urls = collectEventImageUrls(events.map((event) => event.resource));
        ensureOriginHints(urls.map(originOf).filter((origin): origin is string => origin !== null));
        prefetchImages(urls, seen.current);
    }, [events]);
}
