/**
 * ROK-1942 D11 — the ONE Gallery dialog: `Modal` at ≥1024px, `BottomSheet`
 * below (§4.4). Two modes — the "See all" grid and the picture viewer — never
 * two stacked dialogs. The All · Deaths · Screenshots chips (operator ruling
 * 2026-10-24) narrow both modes, and Prev / Next / ←→ walk the FILTERED set
 * (paging in more via `nextCursor` at the end of the loaded list). Editors
 * Hide / Unhide; staff Remove (two-step, inline — no stacked confirm). Closing
 * (Escape, ×, backdrop, swipe) returns focus to the element that opened it.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { isOperatorOrAdmin, useAuth } from '../../../hooks/use-auth';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { availableFilters, type HubMediaFilter } from '../../../lib/hub-media-query';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Modal } from '../../ui/modal';
import { HubGalleryChips } from './hub-gallery-chips';
import { HubGalleryFooter } from './hub-gallery-footer';
import { HubGalleryGrid } from './hub-gallery-grid';
import { type HubGalleryOpenRequest, useHubGalleryStore } from './hub-gallery-store';
import { HubGalleryViewer } from './hub-gallery-viewer';
import { type HubGalleryPages, useHubGalleryPages } from './use-hub-gallery-pages';

export interface HubGalleryDialogProps {
    request: HubGalleryOpenRequest;
    canEdit: boolean;
    canRemove: boolean;
}

function isTyping(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Viewer navigation over the filtered list; Next pages in more at the loaded end. */
function useViewerNav(pages: HubGalleryPages, index: number, setIndex: (i: number) => void) {
    const prev = index > 0 ? () => setIndex(index - 1) : null;
    const next = index + 1 < pages.items.length ? () => setIndex(index + 1)
        : pages.hasMore ? () => { void pages.loadMore().then(() => setIndex(index + 1)); } : null;
    return { prev, next };
}

function useArrowKeys(active: boolean, prev: (() => void) | null, next: (() => void) | null): void {
    useEffect(() => {
        if (!active) return undefined;
        const onKey = (e: KeyboardEvent): void => {
            if (isTyping(e.target)) return;
            if (e.key === 'ArrowLeft' && prev !== null) { e.preventDefault(); prev(); }
            if (e.key === 'ArrowRight' && next !== null) { e.preventDefault(); next(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [active, prev, next]);
}

function useCloseAndReturnFocus(request: HubGalleryOpenRequest): () => void {
    const closeGallery = useHubGalleryStore((s) => s.closeGallery);
    return useCallback(() => {
        const el = request.returnFocus;
        closeGallery();
        // After the overlay unmounts (its own focus restore runs first).
        setTimeout(() => { if (el?.isConnected) el.focus(); }, 0);
    }, [request.returnFocus, closeGallery]);
}

export function HubGalleryDialog({ request, canEdit, canRemove }: HubGalleryDialogProps): JSX.Element {
    const { guildId } = request;
    const desktop = useMediaQuery(DESKTOP_MQ);
    const setCardFilter = useHubGalleryStore((s) => s.setFilter);
    const [mode, setMode] = useState(request.mode);
    const [filter, setFilter] = useState<HubMediaFilter>(request.filter);
    const [rawIndex, setIndex] = useState(request.index);
    const pages = useHubGalleryPages(guildId, filter);
    const index = Math.max(0, Math.min(rawIndex, pages.items.length - 1));
    const item = pages.items[index];
    const nav = useViewerNav(pages, index, setIndex);
    useArrowKeys(mode === 'viewer' && item !== undefined, nav.prev, nav.next);
    const close = useCloseAndReturnFocus(request);
    const changeFilter = (f: HubMediaFilter): void => { setFilter(f); setIndex(0); setCardFilter(guildId, f); };
    const body = (
        <div className="flex flex-col gap-3">
            <HubGalleryChips filters={availableFilters(pages.kinds)} value={filter} onChange={changeFilter} />
            {pages.loading && <p className="py-8 text-center text-sm text-muted">Loading pictures…</p>}
            {!pages.loading && pages.items.length === 0 && <p className="py-8 text-center text-sm text-muted">No pictures here yet.</p>}
            {mode === 'grid' && pages.items.length > 0 && (
                <HubGalleryGrid items={pages.items} total={pages.total} onOpen={(i) => { setIndex(i); setMode('viewer'); }} />
            )}
            {mode === 'viewer' && item !== undefined && (
                <HubGalleryViewer item={item} position={index + 1} total={pages.total} onPrev={nav.prev} onNext={nav.next} />
            )}
        </div>
    );
    const footer = (
        <HubGalleryFooter guildId={guildId} mode={mode} item={mode === 'viewer' ? item : undefined} pages={pages}
            canEdit={canEdit} canRemove={canRemove} onBack={() => setMode('grid')} />
    );
    const shownFooter = mode === 'viewer' || pages.hasMore ? footer : undefined;
    if (desktop) {
        return <Modal isOpen onClose={close} title="Gallery" maxWidth="max-w-3xl" footer={shownFooter}>{body}</Modal>;
    }
    return <BottomSheet isOpen onClose={close} title="Gallery" maxHeight="95vh" footer={shownFooter}>{body}</BottomSheet>;
}

/** Lazy entry (mounted by the Overview card): adds the staff check from the session. */
export default function HubGalleryDialogHost({ request, canEdit }: Omit<HubGalleryDialogProps, 'canRemove'>): JSX.Element {
    const { user } = useAuth();
    return <HubGalleryDialog request={request} canEdit={canEdit} canRemove={isOperatorOrAdmin(user)} />;
}
