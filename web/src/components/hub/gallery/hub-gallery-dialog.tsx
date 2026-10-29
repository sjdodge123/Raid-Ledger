/**
 * ROK-1942 D11 — the ONE Gallery dialog: `Modal` at ≥1024px, `BottomSheet`
 * below (§4.4). Two modes — the "See all" grid and the picture viewer — never
 * two stacked dialogs. The All · Deaths · Screenshots chips (operator ruling
 * 2026-10-24) narrow both modes, and Prev / Next / ←→ walk the FILTERED set
 * (paging in more via `nextCursor` at the end of the loaded list). Editors
 * Hide / Unhide; the hub leader or the uploader Remove (per-item `canRemove`,
 * ROK-1965; two-step, inline — no stacked confirm). Closing
 * (Escape, ×, backdrop, swipe) returns focus to the element that opened it.
 * ROK-2027: a request may carry a plugin-resolved `subject` (one Deaths bar);
 * it is dialog-local (never the card filter, D10) and swaps the chips for one
 * removable "<Name>'s deaths" chip until cleared (D9).
 */
import { type RefObject, useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { availableFilters, clampHubMediaFilter, type HubMediaFilter } from '../../../lib/hub-media-query';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Modal } from '../../ui/modal';
import { HubGalleryChips } from './hub-gallery-chips';
import { HubGallerySubjectChip } from './hub-gallery-subject-chip';
import { HubGalleryFooter } from './hub-gallery-footer';
import { HubGalleryGrid } from './hub-gallery-grid';
import { type HubGalleryOpenRequest, useHubGalleryStore } from './hub-gallery-store';
import { HubGalleryViewer } from './hub-gallery-viewer';
import { HUB_GALLERY_PAGE_SIZE, type HubGalleryPages, useHubGalleryPages } from './use-hub-gallery-pages';

export interface HubGalleryDialogProps {
    request: HubGalleryOpenRequest;
    canEdit: boolean;
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

/** True when `target` sits inside the dialog that holds `scope` (keys aimed at the page behind it are not ours). */
function inDialog(scope: RefObject<HTMLElement | null>, target: EventTarget | null): boolean {
    const root = scope.current?.closest('[role="dialog"]') ?? scope.current;
    return root != null && target instanceof Node && root.contains(target);
}

function useArrowKeys(scope: RefObject<HTMLElement | null>, active: boolean, prev: (() => void) | null, next: (() => void) | null): void {
    useEffect(() => {
        if (!active) return undefined;
        const onKey = (e: KeyboardEvent): void => {
            if (!inDialog(scope, e.target) || isTyping(e.target)) return;
            if (e.key === 'ArrowLeft' && prev !== null) { e.preventDefault(); prev(); }
            if (e.key === 'ArrowRight' && next !== null) { e.preventDefault(); next(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [scope, active, prev, next]);
}

/** ROK-1941: how far the viewer pages in looking for a requested id before it falls back to the index. */
const HUB_GALLERY_SEEK_MAX_PAGES = 10;

/**
 * ROK-1941: a requested id that is not loaded yet (a Deaths thumb whose picture
 * sits past the first page) pages in — once per loaded length — until it is
 * found, the list ends, or the page cap is hit. True while still looking.
 * ROK-1965: a cached list being refetched (an upload invalidated it) is not
 * searched or paged — paging would cancel the refetch and append to the stale
 * pages — so the new picture's id resolves in the fresh list. A refetch also
 * cancels an in-flight page-in and can leave the list at the length already
 * asked for, so `asked` resets while refreshing and the seek asks again after.
 */
function useSeekAnchor(pages: HubGalleryPages, anchorId: number | null, found: boolean): boolean {
    const asked = useRef(-1);
    const pageCap = HUB_GALLERY_SEEK_MAX_PAGES * HUB_GALLERY_PAGE_SIZE;
    const { loading, refreshing, loadingMore, loadMore, items } = pages;
    const seeking = anchorId !== null && !found && (loading || refreshing || (pages.hasMore && items.length < pageCap));
    useEffect(() => {
        if (refreshing) { asked.current = -1; return; }
        if (!seeking || loading || loadingMore || asked.current === items.length) return;
        asked.current = items.length;
        void loadMore();
    }, [seeking, loading, refreshing, loadingMore, loadMore, items.length]);
    return seeking;
}

/** The viewer's index: the requested picture's id resolved in THIS list until the viewer moves, else the clamped index. */
function useViewerIndex(request: HubGalleryOpenRequest, pages: HubGalleryPages) {
    const [anchorId, setAnchorId] = useState<number | null>(request.mediaId ?? null);
    const [rawIndex, setRawIndex] = useState(request.index);
    const anchored = anchorId === null ? -1 : pages.items.findIndex((i) => i.id === anchorId);
    const seeking = useSeekAnchor(pages, anchorId, anchored >= 0);
    const index = anchored >= 0 ? anchored : Math.max(0, Math.min(rawIndex, pages.items.length - 1));
    const setIndex = useCallback((i: number) => { setAnchorId(null); setRawIndex(i); }, []);
    return { index, setIndex, seeking };
}

/** A chip the refreshed `kinds` no longer justify (staff removed its last picture) falls back to All. Not while scoped: no chips show. */
function useClampFilter(pages: HubGalleryPages, filter: HubMediaFilter, changeFilter: (f: HubMediaFilter) => void, scoped: boolean): void {
    const clamped = pages.loading || scoped ? filter : clampHubMediaFilter(filter, pages.kinds);
    useEffect(() => { if (clamped !== filter) changeFilter(clamped); }, [clamped, filter, changeFilter]);
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

type GallerySubject = NonNullable<HubGalleryOpenRequest['subject']>;

/**
 * The dialog's list: chip filter + optional subject (both dialog state), its
 * pages and the viewer index. A chip syncs the card filter; clearing the
 * subject does not (D10) — it returns to the request's filter at index 0.
 */
function useGalleryList(request: HubGalleryOpenRequest) {
    const { guildId } = request;
    const setCardFilter = useHubGalleryStore((s) => s.setFilter);
    const [filter, setFilter] = useState<HubMediaFilter>(request.filter);
    const [subject, setSubject] = useState<GallerySubject | null>(request.subject ?? null);
    const pages = useHubGalleryPages(guildId, filter, subject?.id ?? null);
    const viewer = useViewerIndex(request, pages);
    const { setIndex } = viewer;
    const changeFilter = useCallback((f: HubMediaFilter): void => { setFilter(f); setIndex(0); setCardFilter(guildId, f); }, [setIndex, setCardFilter, guildId]);
    const clearSubject = useCallback((): void => { setSubject(null); setFilter(request.filter); setIndex(0); }, [setIndex, request.filter]);
    useClampFilter(pages, filter, changeFilter, subject !== null);
    return { ...viewer, pages, filter, subject, changeFilter, clearSubject };
}

interface GalleryBodyProps {
    mode: 'grid' | 'viewer';
    filter: HubMediaFilter;
    onFilter: (f: HubMediaFilter) => void;
    subject: GallerySubject | null;
    onClearSubject: () => void;
    pages: HubGalleryPages;
    index: number;
    nav: ReturnType<typeof useViewerNav>;
    onOpen: (index: number) => void;
    scope: RefObject<HTMLDivElement | null>;
    /** Paging in for a requested picture: show "Loading", never a different picture first. */
    seeking: boolean;
}

function GalleryBody({ mode, filter, onFilter, subject, onClearSubject, pages, index, nav, onOpen, scope, seeking }: GalleryBodyProps): JSX.Element {
    const item = seeking ? undefined : pages.items[index];
    const loading = pages.loading || seeking;
    return (
        <div ref={scope} className="flex flex-col gap-3">
            {subject !== null
                ? <HubGallerySubjectChip label={subject.label} onClear={onClearSubject} />
                : <HubGalleryChips filters={availableFilters(pages.kinds)} value={filter} onChange={onFilter} />}
            {loading && <p className="py-8 text-center text-sm text-muted">Loading pictures…</p>}
            {!loading && pages.items.length === 0 && <p className="py-8 text-center text-sm text-muted">No pictures here yet.</p>}
            {mode === 'grid' && !seeking && pages.items.length > 0 && <HubGalleryGrid items={pages.items} total={pages.total} onOpen={onOpen} />}
            {mode === 'viewer' && item !== undefined && (
                <HubGalleryViewer item={item} position={index + 1} total={pages.total} onPrev={nav.prev} onNext={nav.next} />
            )}
        </div>
    );
}

export function HubGalleryDialog({ request, canEdit }: HubGalleryDialogProps): JSX.Element {
    const { guildId } = request;
    const desktop = useMediaQuery(DESKTOP_MQ);
    const [mode, setMode] = useState(request.mode);
    const { index, setIndex, seeking, pages, filter, subject, changeFilter, clearSubject } = useGalleryList(request);
    const item = pages.items[index];
    const nav = useViewerNav(pages, index, setIndex);
    const scope = useRef<HTMLDivElement>(null);
    useArrowKeys(scope, mode === 'viewer' && item !== undefined && !seeking, nav.prev, nav.next);
    const close = useCloseAndReturnFocus(request);
    const body = (
        <GalleryBody mode={mode} filter={filter} onFilter={changeFilter} subject={subject} onClearSubject={clearSubject} pages={pages} index={index}
            nav={nav} scope={scope} seeking={seeking} onOpen={(i) => { setIndex(i); setMode('viewer'); }} />
    );
    const footer = (
        <HubGalleryFooter guildId={guildId} mode={mode} item={mode === 'viewer' && !seeking ? item : undefined} pages={pages}
            canEdit={canEdit} onBack={() => setMode('grid')} />
    );
    if (desktop) {
        return <Modal isOpen onClose={close} title="Gallery" maxWidth="max-w-3xl" footer={footer}>{body}</Modal>;
    }
    return <BottomSheet isOpen onClose={close} title="Gallery" maxHeight="95vh" footer={footer}>{body}</BottomSheet>;
}

/** Lazy entry (`hub-gallery-dialog-mount.tsx`). Remove rights ride on each item (`canRemove`). */
export default HubGalleryDialog;
