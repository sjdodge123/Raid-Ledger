/**
 * ROK-1942 — the Gallery's shared UI state. The Overview card body, its header
 * action and the dialog are separate components (core draws the card chrome),
 * so the chip filter and the "open the dialog" request live here, per hub.
 *
 * L4 SEAM: `HubGalleryDialog` reads `request` (null = closed) and calls
 * `closeGallery()`; the card's tiles open it in `viewer` mode on a picture id,
 * "See all (N)" in `grid` mode. `returnFocus` is the element to refocus on close.
 */
import { useCallback } from 'react';
import { create } from 'zustand';
import type { HubMediaFilter } from '../../../lib/hub-media-query';

export interface HubGalleryOpenRequest {
    guildId: number;
    mode: 'grid' | 'viewer';
    filter: HubMediaFilter;
    /** Viewer mode fallback: the picture's index in the filtered, newest-first list. */
    index: number;
    /**
     * Viewer mode: the picture that was clicked. The dialog fetches its own list,
     * so it resolves this id there (an index alone opens the wrong picture when
     * the list moved between the strip's fetch and the dialog's).
     */
    mediaId?: number;
    /**
     * ROK-2027 — a plugin-resolved scope for the grid (`id` is the list route's
     * `subject`, e.g. `valheim-death:c42`; `label` is the person's display name
     * for the dialog's removable chip). Dialog-local: never written to `filters`.
     */
    subject?: { id: string; label: string };
    /**
     * ROK-2074 — viewer mode on ONE picture that is not a Gallery item (a crest
     * upload, a BG3 save shot with no Gallery twin): no list, chips, Prev/Next or
     * per-media actions — just the picture, close and focus return.
     */
    single?: HubGallerySinglePicture;
    /**
     * ROK-2074 — set (by `openHubPicture`) when `mediaId` is a stored link that
     * may be stale: an id no longer in the Gallery shows this picture alone,
     * or (null) says the picture is gone — never falls back to `index`.
     */
    missing?: HubGallerySinglePicture | null;
    returnFocus: HTMLElement | null;
}

/** A lone picture for the viewer. `auth`: `url` is an API path fetched with the bearer token (else a plain `src`). */
export interface HubGallerySinglePicture {
    url: string;
    alt: string;
    auth?: boolean;
}

/** What `openHubPicture` opens: a Gallery item by id, or a lone picture. */
/** `fallback`: what to show alone if the id is no longer in the Gallery. */
export type HubPictureTarget = { mediaId: number; fallback?: HubGallerySinglePicture } | HubGallerySinglePicture;

interface HubGalleryState {
    filters: Record<number, HubMediaFilter>;
    request: HubGalleryOpenRequest | null;
    setFilter: (guildId: number, filter: HubMediaFilter) => void;
    openGallery: (request: HubGalleryOpenRequest) => void;
    closeGallery: () => void;
}

export const useHubGalleryStore = create<HubGalleryState>((set) => ({
    filters: {},
    request: null,
    setFilter: (guildId, filter) => set((s) => ({ filters: { ...s.filters, [guildId]: filter } })),
    openGallery: (request) => set({ request }),
    closeGallery: () => set({ request: null }),
}));

/** The hub's current chip filter (default All). */
export function useHubGalleryFilter(guildId: number): HubMediaFilter {
    return useHubGalleryStore((s) => s.filters[guildId] ?? 'all');
}

/**
 * ROK-2074 (review) — an authed picture's url is concatenated onto the API
 * base, so the bearer token only goes with a same-origin API path: a leading
 * `/`, never `//` (protocol-relative) and no backslash (browsers read `\`
 * as `/`). Anything else is never fetched with the token.
 */
export function isSameOriginApiPath(url: string): boolean {
    return url.startsWith('/') && !url.startsWith('//') && !url.includes('\\');
}

/** The bearer token only goes with a same-origin API path. */
function isSafePicture(picture: HubGallerySinglePicture): boolean {
    return picture.auth !== true || isSameOriginApiPath(picture.url);
}

/**
 * ROK-2074 — open one hub picture in the Gallery viewer: a Gallery item by
 * `mediaId` (Prev/Next walk All from there), or `{ url, alt }` alone. The
 * hub page mounts the dialog, so any widget — core or plugin — can call this.
 */
export function openHubPicture(guildId: number, target: HubPictureTarget, returnFocus: HTMLElement | null): void {
    if ('url' in target && !isSafePicture(target)) return;
    const base = { guildId, mode: 'viewer', filter: 'all', index: 0, returnFocus } as const;
    if (!('mediaId' in target)) { useHubGalleryStore.getState().openGallery({ ...base, single: target }); return; }
    const fallback = target.fallback !== undefined && isSafePicture(target.fallback) ? target.fallback : null;
    useHubGalleryStore.getState().openGallery({ ...base, mediaId: target.mediaId, missing: fallback });
}

/** Close the dialog, then refocus the element that opened it (after the overlay's own focus restore). */
export function useCloseGalleryAndReturnFocus(request: HubGalleryOpenRequest): () => void {
    const closeGallery = useHubGalleryStore((s) => s.closeGallery);
    return useCallback(() => {
        const el = request.returnFocus;
        closeGallery();
        setTimeout(() => { if (el?.isConnected) el.focus(); }, 0);
    }, [request.returnFocus, closeGallery]);
}
