/**
 * TabRow — hash-synced underline tab links (ROK-1785, spec ROK-1781 D8).
 *
 * Promoted from the ROK-1781 guild-page prototype (`GuildTabRow`). Each tab is
 * a plain `<a href="#id">`, so every tab deep-links and the browser's own
 * hash navigation drives the state; the current tab carries
 * `aria-current="page"` and the `success` underline. Pair it with
 * `useHashTab(ids, defaultId)` (`tab-row.helpers.ts`), which reads
 * `location.hash` and follows `hashchange` / `popstate`.
 *
 * Panels: give the active panel the id `tabPanelId(prefix, id)` →
 * `<prefix>-tab-<id>`, NEVER the bare id — a bare id makes the browser jump to
 * the panel on load and on every tab click.
 *
 * Phone: the row never wraps; it scrolls sideways inside its own `<nav>`
 * (thin scrollbar, shown only when the row overflows), so the page never scrolls
 * horizontally. `overflow-y-hidden` matters: the tabs' `-mb-px` underline overlap
 * is 1px of vertical overflow, which otherwise draws a vertical scrollbar at the
 * row's right end on phones (ROK-1785 verify flag). When the active
 * tab is clipped by the row (a deep link to the last tab on a phone), it is
 * scrolled into view on mount and on every change. An unclipped tab is left
 * alone, so a row far down the page never drags the page to it on load.
 *
 * More menu (ROK-1876, tab-row ruling 2026-10-21 option A): when the tabs do
 * not fit at the row's measured width (any viewport), the first ones that fit
 * stay and the rest go behind a "More ▾" §4.14 menu (`tab-row-more.tsx`,
 * split by `useTabRowFit` in `tab-row-fit.ts`). A hidden active tab names the
 * trigger ("Planner ▾", underlined); the row never reorders. The sideways
 * scroll stays as the fallback for a row too narrow even for one tab + More.
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { FOCUS_RING } from './form-classes';
import { useTabRowFit } from './tab-row-fit';
import { TabRowMeasure, TabRowMore } from './tab-row-more';
import { ROW_SCROLL, TAB_BASE, TAB_OFF, TAB_ON } from './tab-row.classes';

export interface TabRowTab {
    id: string;
    label: string;
    /** Not rendered. Leave its id out of `useHashTab`'s `ids` too. */
    hidden?: boolean;
}

export interface TabRowProps {
    tabs: readonly TabRowTab[];
    activeId: string;
    /** Accessible name of the `<nav>`, e.g. "Guild page sections". */
    label: string;
    className?: string;
}

function isClipped(tab: HTMLElement, row: HTMLElement): boolean {
    const t = tab.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return t.left < r.left || t.right > r.right;
}

/** Scrolls the active tab into the row's view when the row clips it. */
function useRevealActive(activeId: string) {
    const rowRef = useRef<HTMLUListElement>(null);
    const activeRef = useRef<HTMLAnchorElement>(null);
    useEffect(() => {
        const row = rowRef.current;
        const tab = activeRef.current;
        if (!row || !tab || !isClipped(tab, row)) return;
        tab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }, [activeId]);
    return { rowRef, activeRef };
}

export function TabRow({ tabs, activeId, label, className = '' }: TabRowProps): JSX.Element {
    const shown = useMemo(() => tabs.filter((t) => !t.hidden), [tabs]);
    const navRef = useRef<HTMLElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const { count, activeHidden } = useTabRowFit(navRef, measureRef, shown, activeId);
    const { rowRef, activeRef } = useRevealActive(activeId);
    const overflow = shown.slice(count);
    return (
        <nav ref={navRef} aria-label={label} className={`relative flex border-b border-edge ${className}`}>
            <ul ref={rowRef} data-testid="tab-row-scroller" className={`flex min-w-0 flex-1 gap-1 ${ROW_SCROLL}`}>
                {shown.slice(0, count).map((t) => {
                    const on = t.id === activeId;
                    return (
                        <li key={t.id} className="shrink-0">
                            <a href={`#${t.id}`} ref={on ? activeRef : undefined} aria-current={on ? 'page' : undefined}
                                className={`${TAB_BASE} ${on ? TAB_ON : TAB_OFF} ${FOCUS_RING}`}>
                                {t.label}
                            </a>
                        </li>
                    );
                })}
            </ul>
            {overflow.length > 0 && <TabRowMore tabs={overflow} activeId={activeId} activeHidden={activeHidden} />}
            <TabRowMeasure tabs={shown} measureRef={measureRef} />
        </nav>
    );
}
