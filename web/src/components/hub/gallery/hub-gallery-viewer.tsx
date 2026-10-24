/**
 * ROK-1942 — the Gallery dialog's viewer mode (approved mockup frames 3 / 4):
 * the full picture in a `bg-media-well` well (near-black in every scheme) with 44px Prev / Next buttons over
 * its edges, "3 of 24", and a caption line — kind badge, who, when, source,
 * the optional source link. The dialog owns the ←/→ keys and the footer.
 */
import { useEffect, useRef, type JSX } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { useHubMediaImageUrl } from '../../../hooks/use-hub-media-image';
import { syncedAgo } from '../../../lib/synced-ago';
import { Button } from '../../ui/button';
import { HUB_MEDIA_KIND_LABEL } from './hub-gallery-labels';

export interface HubGalleryViewerProps {
    item: HubMediaItem;
    position: number;
    total: number;
    onPrev: (() => void) | null;
    onNext: (() => void) | null;
}

const WHEN = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } as const;

function Caption({ item }: { item: HubMediaItem }): JSX.Element {
    const badge = item.kind === 'death' ? 'border-danger' : 'border-edge-strong';
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="hub-gallery-caption">
            <span className={`rounded-full border bg-surface px-2 text-[11px] leading-5 text-foreground ${badge}`}>
                {HUB_MEDIA_KIND_LABEL[item.kind]}
            </span>
            {item.authorName !== null && <strong className="text-foreground">{item.authorName}</strong>}
            <span className="text-muted">
                <time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleString(undefined, WHEN)}</time>
                {` · ${syncedAgo(item.capturedAt)}`}
            </span>
            {item.source.label !== null && <span className="text-muted">From {item.source.label}</span>}
            {item.hidden && <span className="text-muted">Hidden from members</span>}
            {item.caption !== null && <p className="w-full text-secondary">{item.caption}</p>}
            {item.link !== null && <a href={item.link.href} className="font-medium text-success hover:underline">{item.link.label}</a>}
        </div>
    );
}

function NavButton({ side, onClick }: { side: 'prev' | 'next'; onClick: (() => void) | null }): JSX.Element {
    const label = side === 'prev' ? 'Previous picture' : 'Next picture';
    // `aria-disabled`, not `disabled`: a native-disabled button at either end drops focus to the page.
    const off = onClick === null;
    // The wrapper takes the absolute position: Button's base classes carry `relative`, which wins over an `absolute` className.
    return (
        <span data-testid={`hub-gallery-${side}-slot`} className={`absolute top-1/2 -translate-y-1/2 ${side === 'prev' ? 'left-2' : 'right-2'}`}>
            <Button variant="secondary" iconOnly aria-label={label} aria-disabled={off || undefined} onClick={() => onClick?.()}
                data-testid={`hub-gallery-${side}`}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
                <span aria-hidden="true">{side === 'prev' ? '‹' : '›'}</span>
            </Button>
        </span>
    );
}

export function HubGalleryViewer({ item, position, total, onPrev, onNext }: HubGalleryViewerProps): JSX.Element {
    const url = useHubMediaImageUrl(item.fullPath);
    const region = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // Coming from the grid, the clicked tile is gone: keep focus inside the dialog.
        const el = region.current;
        if (el !== null && !el.contains(document.activeElement)) el.focus();
    }, []);
    return (
        <div ref={region} tabIndex={-1} className="flex flex-col gap-3 outline-none" data-testid="hub-gallery-viewer">
            <p className="text-sm text-muted" aria-live="polite">{position} of {total}</p>
            <div data-testid="hub-gallery-stage"
                className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-media-well lg:aspect-video">
                {url === null
                    ? <span className="text-sm text-media-well-foreground">Loading picture…</span>
                    : <img src={url} alt={`${HUB_MEDIA_KIND_LABEL[item.kind]} picture${item.authorName === null ? '' : ` by ${item.authorName}`}`}
                        className="max-h-full max-w-full object-contain" />}
                <NavButton side="prev" onClick={onPrev} />
                <NavButton side="next" onClick={onNext} />
            </div>
            <Caption item={item} />
        </div>
    );
}
