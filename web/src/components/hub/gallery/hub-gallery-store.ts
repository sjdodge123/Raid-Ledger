/**
 * ROK-1942 — the Gallery's shared UI state. The Overview card body, its header
 * action and the dialog are separate components (core draws the card chrome),
 * so the chip filter and the "open the dialog" request live here, per hub.
 *
 * L4 SEAM: `HubGalleryDialog` reads `request` (null = closed) and calls
 * `closeGallery()`; the card's tiles open it in `viewer` mode on a picture id,
 * "See all (N)" in `grid` mode. `returnFocus` is the element to refocus on close.
 */
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
    returnFocus: HTMLElement | null;
}

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
