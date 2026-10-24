/**
 * ROK-1942 — the Gallery dialog's pinned footer (bare buttons; the overlay
 * draws the `OVERLAY_FOOTER_CLASS` bar). Grid: "Load more" while `nextCursor`
 * has more. Viewer: "Back to all", editors' Hide / Unhide, staff Remove —
 * which asks inline ("Remove for good") instead of stacking a confirm dialog.
 */
import { useState, type JSX } from 'react';
import type { HubMediaItem } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { type HubGalleryPages, useHubGalleryModeration } from './use-hub-gallery-pages';

export interface HubGalleryFooterProps {
    guildId: number;
    mode: 'grid' | 'viewer';
    item: HubMediaItem | undefined;
    pages: HubGalleryPages;
    canEdit: boolean;
    canRemove: boolean;
    onBack: () => void;
}

function ModerationButtons({ guildId, item, canEdit, canRemove }: {
    guildId: number; item: HubMediaItem; canEdit: boolean; canRemove: boolean;
}): JSX.Element {
    const mod = useHubGalleryModeration(guildId);
    const [confirmId, setConfirmId] = useState<number | null>(null);
    const confirming = confirmId === item.id;
    return (
        <>
            {canEdit && (item.hidden
                ? <Button variant="success-soft" disabled={mod.busy} onClick={() => mod.setHidden(item.id, false)}>Unhide</Button>
                : <Button variant="warning-soft" disabled={mod.busy} onClick={() => mod.setHidden(item.id, true)}>Hide</Button>)}
            {canRemove && (confirming
                ? <Button variant="destructive" disabled={mod.busy} onClick={() => { setConfirmId(null); mod.remove(item.id); }}>Remove for good</Button>
                : <Button variant="destructive-soft" disabled={mod.busy} onClick={() => setConfirmId(item.id)}>Remove</Button>)}
        </>
    );
}

export function HubGalleryFooter({ guildId, mode, item, pages, canEdit, canRemove, onBack }: HubGalleryFooterProps): JSX.Element | null {
    if (mode === 'grid') {
        if (!pages.hasMore) return null;
        return (
            <Button variant="secondary" loading={pages.loadingMore} onClick={() => { void pages.loadMore(); }}>Load more</Button>
        );
    }
    return (
        <>
            <Button variant="secondary" onClick={onBack}>Back to all</Button>
            {item !== undefined && (canEdit || canRemove) && (
                <ModerationButtons guildId={guildId} item={item} canEdit={canEdit} canRemove={canRemove} />
            )}
        </>
    );
}
