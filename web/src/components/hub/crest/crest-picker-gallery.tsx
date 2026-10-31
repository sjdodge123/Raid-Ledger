/**
 * ROK-1814 — the picker's Gallery section (operator ruling Q1: pick one of
 * this hub's visible pictures). The thumbnails are a radio group with a roving
 * tab stop (arrow keys / Home / End move and select), and "Load more" pages
 * through the hub gallery like the Gallery dialog's footer.
 */
import { useRef, type JSX, type KeyboardEvent } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useHubMediaImageUrl } from '../../../hooks/use-hub-media-image';
import { useHubGalleryPages } from '../gallery/use-hub-gallery-pages';
import { radioKeyTarget } from './crest-picker-keys';

interface ThumbProps {
    item: HubMediaItem;
    selected: boolean;
    tabbable: boolean;
    onPick: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
    buttonRef: (el: HTMLButtonElement | null) => void;
}

function GalleryThumb({ item, selected, tabbable, onPick, onKeyDown, buttonRef }: ThumbProps): JSX.Element {
    const src = useHubMediaImageUrl(item.thumbPath);
    return (
        <Button
            variant="bare" role="radio" aria-checked={selected} aria-label={item.caption ?? `Picture ${item.id}`}
            tabIndex={tabbable ? 0 : -1} onClick={onPick} onKeyDown={onKeyDown} ref={buttonRef}
            data-testid={`crest-gallery-option-${item.id}`}
            className={`h-20 w-20 overflow-hidden rounded-lg border-2 bg-surface focus-visible:ring-offset-2 focus-visible:ring-offset-panel [&>[data-button-label]]:h-full [&>[data-button-label]]:w-full ${selected ? 'border-success' : 'border-edge'}`}
        >
            {src && <img src={src} alt="" className="h-full w-full object-cover" />}
        </Button>
    );
}

interface GalleryRadiosProps { items: HubMediaItem[]; mediaId: number | null; onPick: (id: number) => void }

function GalleryRadios({ items, mediaId, onPick }: GalleryRadiosProps): JSX.Element {
    const refs = useRef(new Map<number, HTMLButtonElement>());
    const ids = items.map((i) => i.id);
    const tabStop = mediaId !== null && ids.includes(mediaId) ? mediaId : ids[0];
    const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLButtonElement>): void => {
        const target = radioKeyTarget(ids, index, e.key);
        if (target === undefined) return;
        e.preventDefault();
        onPick(target);
        refs.current.get(target)?.focus();
    };
    return (
        <div role="radiogroup" aria-label="Gallery pictures" className="flex flex-wrap gap-2">
            {items.map((item, index) => (
                <GalleryThumb
                    key={item.id} item={item} selected={item.id === mediaId} tabbable={item.id === tabStop}
                    onPick={() => onPick(item.id)} onKeyDown={onKeyDown(index)}
                    buttonRef={(el) => { if (el) refs.current.set(item.id, el); else refs.current.delete(item.id); }}
                />
            ))}
        </div>
    );
}

interface CrestGallerySectionProps {
    guildId: number;
    mediaId: number | null;
    onPick: (id: number) => void;
}

export function CrestGallerySection({ guildId, mediaId, onPick }: CrestGallerySectionProps): JSX.Element {
    const pages = useHubGalleryPages(guildId, 'all');
    const items = pages.items.filter((i) => !i.hidden);
    if (pages.loading) return <p className="text-sm text-muted">Loading the gallery…</p>;
    if (items.length === 0 && !pages.hasMore) return <p className="text-sm text-muted" data-testid="crest-gallery-empty">This hub's gallery has no pictures yet.</p>;
    return (
        <div className="flex flex-col gap-2" data-testid="crest-gallery-grid">
            <p className="text-xs text-muted">The picture is copied, cropped square and shown publicly as the crest.</p>
            <GalleryRadios items={items} mediaId={mediaId} onPick={onPick} />
            {pages.hasMore && (
                <Button variant="secondary" size="sm" className="self-start" loading={pages.loadingMore} onClick={() => { void pages.loadMore(); }}>
                    Load more
                </Button>
            )}
        </div>
    );
}
