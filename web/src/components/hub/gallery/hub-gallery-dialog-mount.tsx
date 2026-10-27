/**
 * ROK-1941 D14 — the hub's ONE Gallery dialog, mounted by the Overview (not the
 * Gallery card), so anything on the page can open it through
 * `hub-gallery-store` — a Deaths thumbnail included — even when an officer hid
 * the Gallery card. The dialog chunk loads only once a request names this hub.
 */
import { lazy, Suspense, type JSX } from 'react';
import { useHubGalleryStore } from './hub-gallery-store';

const HubGalleryDialogHost = lazy(() => import('./hub-gallery-dialog'));

export interface HubGalleryDialogMountProps {
    guildId: number;
    canEdit: boolean;
}

/** Renders the dialog while the store holds an open request for `guildId`; nothing otherwise. */
export function HubGalleryDialogMount({ guildId, canEdit }: HubGalleryDialogMountProps): JSX.Element | null {
    const request = useHubGalleryStore((s) => s.request);
    if (request === null || request.guildId !== guildId) return null;
    return <Suspense fallback={null}><HubGalleryDialogHost request={request} canEdit={canEdit} /></Suspense>;
}
