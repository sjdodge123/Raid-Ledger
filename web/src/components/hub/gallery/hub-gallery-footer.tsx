/**
 * ROK-1942 — the Gallery dialog's pinned footer (bare buttons; the overlay
 * draws the `OVERLAY_FOOTER_CLASS` bar). Grid: "Add picture" (ROK-1965), plus
 * "Load more" while `nextCursor` has more. Viewer: "Back to all", editors'
 * Hide / Unhide, and Remove when the server says this viewer may (`canRemove`:
 * the hub leader, or the uploader) — which asks inline ("Remove for good")
 * instead of stacking a confirm dialog.
 */
import { useState, type JSX } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { HubGalleryAddPicture } from './hub-gallery-add-picture';
import { type HubGalleryPages, useHubGalleryModeration } from './use-hub-gallery-pages';

export interface HubGalleryFooterProps {
    guildId: number;
    mode: 'grid' | 'viewer';
    item: HubMediaItem | undefined;
    pages: HubGalleryPages;
    canEdit: boolean;
    onBack: () => void;
}

function ModerationButtons({ guildId, item, canEdit }: {
    guildId: number; item: HubMediaItem; canEdit: boolean;
}): JSX.Element {
    const mod = useHubGalleryModeration(guildId);
    const [confirmId, setConfirmId] = useState<number | null>(null);
    const confirming = confirmId === item.id;
    return (
        <>
            {canEdit && (item.hidden
                ? <Button variant="success-soft" disabled={mod.busy} onClick={() => mod.setHidden(item.id, false)}>Unhide</Button>
                : <Button variant="warning-soft" disabled={mod.busy} onClick={() => mod.setHidden(item.id, true)}>Hide</Button>)}
            {item.canRemove && (confirming
                ? <Button variant="destructive" disabled={mod.busy} onClick={() => { setConfirmId(null); mod.remove(item.id); }}>Remove for good</Button>
                : <Button variant="destructive-soft" disabled={mod.busy} onClick={() => setConfirmId(item.id)}>Remove</Button>)}
        </>
    );
}

export function HubGalleryFooter({ guildId, mode, item, pages, canEdit, onBack }: HubGalleryFooterProps): JSX.Element {
    if (mode === 'grid') {
        return (
            <>
                <HubGalleryAddPicture guildId={guildId} inputTestId="hub-gallery-grid-add-picture-input" />
                {pages.hasMore && (
                    <Button variant="secondary" loading={pages.loadingMore} onClick={() => { void pages.loadMore(); }}>Load more</Button>
                )}
            </>
        );
    }
    return (
        <>
            <Button variant="secondary" onClick={onBack}>Back to all</Button>
            {item !== undefined && (canEdit || item.canRemove) && (
                <ModerationButtons guildId={guildId} item={item} canEdit={canEdit} />
            )}
        </>
    );
}
