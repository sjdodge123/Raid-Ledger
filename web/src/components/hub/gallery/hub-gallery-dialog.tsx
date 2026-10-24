/**
 * ROK-1942 D11 — the ONE Gallery dialog: `Modal` at ≥1024px, `BottomSheet`
 * below (§4.4). Two modes — the "See all" grid and the picture viewer — never
 * two stacked dialogs. The All · Deaths · Screenshots chips (operator ruling
 * 2026-10-24) narrow both modes, and Prev / Next / ←→ walk the FILTERED set
 * (paging in more via `nextCursor` at the end of the loaded list). Editors
 * Hide / Unhide; staff Remove (two-step, inline — no stacked confirm). Closing
 * (Escape, ×, backdrop, swipe) returns focus to the element that opened it.
 */
import { type RefObject, useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { isOperatorOrAdmin, useAuth } from '../../../hooks/use-auth';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { availableFilters, clampHubMediaFilter, type HubMediaFilter } from '../../../lib/hub-media-query';
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

/** The viewer's index: the requested picture's id resolved in THIS list until the viewer moves, else the clamped index. */
function useViewerIndex(request: HubGalleryOpenRequest, pages: HubGalleryPages) {
    const [anchorId, setAnchorId] = useState<number | null>(request.mediaId ?? null);
    const [rawIndex, setRawIndex] = useState(request.index);
    const anchored = anchorId === null ? -1 : pages.items.findIndex((i) => i.id === anchorId);
    const index = anchored >= 0 ? anchored : Math.max(0, Math.min(rawIndex, pages.items.length - 1));
    const setIndex = useCallback((i: number) => { setAnchorId(null); setRawIndex(i); }, []);
    return { index, setIndex };
}

/** A chip the refreshed `kinds` no longer justify (staff removed its last picture) falls back to All. */
function useClampFilter(pages: HubGalleryPages, filter: HubMediaFilter, changeFilter: (f: HubMediaFilter) => void): void {
    const clamped = pages.loading ? filter : clampHubMediaFilter(filter, pages.kinds);
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

interface GalleryBodyProps {
    mode: 'grid' | 'viewer';
    filter: HubMediaFilter;
    onFilter: (f: HubMediaFilter) => void;
    pages: HubGalleryPages;
    index: number;
    nav: ReturnType<typeof useViewerNav>;
    onOpen: (index: number) => void;
    scope: RefObject<HTMLDivElement | null>;
}

function GalleryBody({ mode, filter, onFilter, pages, index, nav, onOpen, scope }: GalleryBodyProps): JSX.Element {
    const item = pages.items[index];
    return (
        <div ref={scope} className="flex flex-col gap-3">
            <HubGalleryChips filters={availableFilters(pages.kinds)} value={filter} onChange={onFilter} />
            {pages.loading && <p className="py-8 text-center text-sm text-muted">Loading pictures…</p>}
            {!pages.loading && pages.items.length === 0 && <p className="py-8 text-center text-sm text-muted">No pictures here yet.</p>}
            {mode === 'grid' && pages.items.length > 0 && <HubGalleryGrid items={pages.items} total={pages.total} onOpen={onOpen} />}
            {mode === 'viewer' && item !== undefined && (
                <HubGalleryViewer item={item} position={index + 1} total={pages.total} onPrev={nav.prev} onNext={nav.next} />
            )}
        </div>
    );
}

export function HubGalleryDialog({ request, canEdit, canRemove }: HubGalleryDialogProps): JSX.Element {
    const { guildId } = request;
    const desktop = useMediaQuery(DESKTOP_MQ);
    const setCardFilter = useHubGalleryStore((s) => s.setFilter);
    const [mode, setMode] = useState(request.mode);
    const [filter, setFilter] = useState<HubMediaFilter>(request.filter);
    const pages = useHubGalleryPages(guildId, filter);
    const { index, setIndex } = useViewerIndex(request, pages);
    const item = pages.items[index];
    const nav = useViewerNav(pages, index, setIndex);
    const scope = useRef<HTMLDivElement>(null);
    useArrowKeys(scope, mode === 'viewer' && item !== undefined, nav.prev, nav.next);
    const close = useCloseAndReturnFocus(request);
    const changeFilter = useCallback((f: HubMediaFilter): void => { setFilter(f); setIndex(0); setCardFilter(guildId, f); }, [setIndex, setCardFilter, guildId]);
    useClampFilter(pages, filter, changeFilter);
    const body = (
        <GalleryBody mode={mode} filter={filter} onFilter={changeFilter} pages={pages} index={index}
            nav={nav} scope={scope} onOpen={(i) => { setIndex(i); setMode('viewer'); }} />
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
