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
 */
import { useEffect, useRef, type JSX } from 'react';
import { FOCUS_RING } from './form-classes';

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

const TAB_BASE =
    'inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors -mb-px rounded-t focus-visible:ring-inset';
const TAB_ON = 'border-success text-foreground';
const TAB_OFF = 'border-transparent text-muted hover:border-edge-strong hover:text-foreground';
const ROW_SCROLL =
    'overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-edge-strong';

function isClipped(tab: HTMLElement, row: HTMLElement): boolean {
    const t = tab.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return t.left < r.left || t.right > r.right;
}

/** Scrolls the active tab into the row's view when the row clips it. */
function useRevealActive(activeId: string) {
    const rowRef = useRef<HTMLElement>(null);
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
    const { rowRef, activeRef } = useRevealActive(activeId);
    return (
        <nav ref={rowRef} aria-label={label} className={`border-b border-edge ${ROW_SCROLL} ${className}`}>
            <ul className="flex w-max gap-1">
                {tabs.filter((t) => !t.hidden).map((t) => {
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
        </nav>
    );
}
