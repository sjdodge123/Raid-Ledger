/**
 * ROK-1173 — the windowed Members list. A guild can carry 2000 rows, so the
 * list scrolls inside its own box (at most 70% of the viewport) and mounts
 * only the rows in view plus `OVERSCAN` each side; spacers keep the scrollbar
 * honest. No dependency (Lead ruling Q1): rows and band headings have fixed
 * heights, so the window is plain arithmetic (`hub-member-virtual.helpers.ts`).
 *
 * Focus: the box itself is a tab stop (a keyboard user can scroll it), rows
 * are plain rows whose only focusables are the cells' own links — tabbing
 * past the last mounted row leaves the list instead of trapping focus. When a
 * scroll unmounts the row holding focus, focus moves to the box itself rather
 * than dropping to <body> (`useKeepFocusInList`).
 *
 * A new sort / filter / search (a new `bands` array) scrolls back to the top.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject, type UIEvent } from 'react';
import type { HubMemberColumn, HubMemberRow } from '../../plugins/hub-module';
import type { HubMemberBand } from './hub-members.helpers';
import { HubMemberCards, HubMemberTable } from './hub-member-table';
import { FOCUS_RING } from '../ui/form-classes';
import { CARD_METRICS, TABLE_METRICS, virtualSlice } from './hub-member-virtual.helpers';

/** Share of the window height the list box may take (matches `max-h-[70vh]`). */
const VIEWPORT_SHARE = 0.7;
/** Items mounted beyond each edge of the viewport. */
export const OVERSCAN = 8;

function viewportHeight(): number {
    return Math.round(window.innerHeight * VIEWPORT_SHARE);
}

/** The list box's height cap in px, following window resizes. */
function useViewportHeight(): number {
    const [height, setHeight] = useState(viewportHeight);
    useEffect(() => {
        const onResize = (): void => setHeight(viewportHeight());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return height;
}

interface Props {
    bands: readonly HubMemberBand[];
    columns: readonly HubMemberColumn[];
    rowClass: ((row: HubMemberRow) => string) | undefined;
    /** 1024px and up: the table shell; below: the cards. */
    desktop: boolean;
}

/** Back to the top whenever the list itself changes (sort, filter, search, grouping). */
function useResetScrollOnChange(ref: RefObject<HTMLDivElement | null>, bands: Props['bands'], setScrollTop: (top: number) => void): void {
    useEffect(() => {
        if (ref.current) ref.current.scrollTop = 0;
        setScrollTop(0);
    }, [ref, bands, setScrollTop]);
}

/**
 * Remembers, at each scroll, whether focus was inside the box; if the re-render
 * then unmounted the focused row, focus goes to the box instead of <body>.
 */
function useKeepFocusInList(ref: RefObject<HTMLDivElement | null>, slice: unknown): (el: HTMLDivElement) => void {
    const focusWasInside = useRef(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !focusWasInside.current) return;
        focusWasInside.current = false;
        if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    }, [ref, slice]);
    return (el) => { focusWasInside.current = el.contains(document.activeElement); };
}

export function HubMemberVirtualList({ bands, columns, rowClass, desktop }: Props): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const viewport = useViewportHeight();
    const metrics = desktop ? TABLE_METRICS : CARD_METRICS;
    const slice = useMemo(
        () => virtualSlice(bands, metrics, scrollTop, viewport, OVERSCAN),
        [bands, metrics, scrollTop, viewport],
    );
    useResetScrollOnChange(ref, bands, setScrollTop);
    const noteFocus = useKeepFocusInList(ref, slice);
    const onScroll = (e: UIEvent<HTMLDivElement>): void => {
        noteFocus(e.currentTarget);
        setScrollTop(e.currentTarget.scrollTop);
    };
    const Shell = desktop ? HubMemberTable : HubMemberCards;
    return (
        <div ref={ref} role="region" aria-label="Members list" tabIndex={0} onScroll={onScroll} data-testid="guild-members-scroller"
            className={`max-h-[70vh] max-w-full overflow-auto overscroll-contain rounded-lg border border-edge ${FOCUS_RING}`}>
            <Shell slice={slice} columns={columns} rowClass={rowClass} />
        </div>
    );
}
