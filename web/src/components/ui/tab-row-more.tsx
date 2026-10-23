/**
 * TabRow's "More ▾" menu and measure layer (ROK-1876, tab-row ruling
 * 2026-10-21 option A; prototype claude.ai/artifact/J8khuGSpFARHC5N7rdkfxc).
 *
 * The trigger reads "More" — or, when the active tab is one of the hidden
 * ones, that tab's name with the active underline. The menu follows the §4.14
 * keyboard model (`menu-keys.ts`): first item focused on open, arrows wrap,
 * Home/End jump, Esc / Tab / an outside press / a pick close it. Items stay
 * plain `<a href="#id">` links, so the hash still drives the state; the active
 * one carries `aria-current="page"`.
 */
import { useCallback, useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type RefObject } from 'react';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { FOCUS_RING } from './form-classes';
import { onMenuKeyDown, useFocusFirstItem } from './menu-keys';
import type { TabRowTab } from './tab-row';
import { TAB_BASE, TAB_OFF, TAB_ON } from './tab-row.classes';

type Close = (restoreFocus?: boolean) => void;

const ITEM =
    'flex min-h-[44px] items-center justify-between gap-3 rounded-md px-3 text-sm font-medium transition-colors hover:bg-overlay hover:text-foreground focus-visible:bg-overlay focus-visible:outline-none';

/** Closes the menu on a pointerdown (mouse, touch or pen) outside `root` while it is open. */
function useOutsidePressClose(root: RefObject<HTMLDivElement | null>, isOpen: boolean, close: Close): void {
    useEffect(() => {
        if (!isOpen) return undefined;
        const onDown = (e: PointerEvent): void => {
            if (e.target instanceof Node && root.current?.contains(e.target)) return;
            close();
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [root, isOpen, close]);
}

interface MenuProps { id: string; tabs: readonly TabRowTab[]; activeId: string; close: Close }

function MoreMenu({ id, tabs, activeId, close }: MenuProps): JSX.Element {
    const menuRef = useRef<HTMLDivElement>(null);
    useFocusFirstItem(menuRef, true);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
        // Focus goes back to the trigger first, so Tab's default move continues from it.
        else if (e.key === 'Tab') close(true);
        else onMenuKeyDown(e);
    };
    // Any pick (keyboard, mouse or touch) returns focus to the trigger, which now names the picked
    // tab — the focused item unmounts, and focus must not fall to <body>.
    const onPick = (): void => close(true);
    return (
        <div ref={menuRef} id={id} role="menu" aria-label="More sections" onKeyDown={onKeyDown} data-testid="tab-row-more-menu"
            className="absolute right-0 top-full z-50 mt-1.5 flex min-w-[12rem] flex-col rounded-lg border border-edge bg-surface p-1.5 shadow-xl">
            {tabs.map((t) => {
                const on = t.id === activeId;
                return (
                    <a key={t.id} href={`#${t.id}`} role="menuitem" aria-current={on ? 'page' : undefined} onClick={onPick}
                        data-testid={`tab-row-more-item-${t.id}`} className={`${ITEM} ${on ? 'text-foreground' : 'text-secondary'}`}>
                        <span>{t.label}</span>
                        {on && <CheckIcon className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
                    </a>
                );
            })}
        </div>
    );
}

interface MoreProps {
    /** The tabs behind the trigger, in row order. */
    tabs: readonly TabRowTab[];
    activeId: string;
    /** The active tab is one of `tabs`: the trigger shows its name, underlined. */
    activeHidden: boolean;
}

export function TabRowMore({ tabs, activeId, activeHidden }: MoreProps): JSX.Element {
    // Open FOR an active tab: a hash change from outside (Back, an in-page link) closes it, and the
    // reset (set-state-during-render) stops Forward back to that tab from reopening it unclicked.
    const [openFor, setOpenFor] = useState<string | null>(null);
    if (openFor !== null && openFor !== activeId) setOpenFor(null);
    const isOpen = openFor === activeId;
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const close = useCallback<Close>((restoreFocus = false) => {
        setOpenFor(null);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);
    useOutsidePressClose(rootRef, isOpen, close);
    const active = activeHidden ? tabs.find((t) => t.id === activeId) : undefined;
    return (
        <div ref={rootRef} className="relative shrink-0 pl-1">
            <button ref={triggerRef} type="button" onClick={() => setOpenFor((o) => (o === activeId ? null : activeId))} aria-haspopup="menu" aria-expanded={isOpen}
                aria-controls={isOpen ? menuId : undefined} aria-label={active ? `${active.label}, more sections` : undefined}
                data-testid="tab-row-more-trigger" data-active={active ? 'true' : undefined}
                className={`${TAB_BASE} gap-1 ${active ? TAB_ON : TAB_OFF} ${FOCUS_RING}`}>
                {active?.label ?? 'More'}
                <ChevronDownIcon className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {isOpen && <MoreMenu id={menuId} tabs={tabs} activeId={activeId} close={close} />}
        </div>
    );
}

const MEASURE_LABEL = 'before:content-[attr(data-label)]';

/**
 * Invisible copies of every tab, the "More ▾" trigger and each "<label> ▾"
 * trigger, for `useTabRowFit`. Labels are CSS `content`, not text nodes, so
 * screen readers and `getByText` never see a second copy of a tab name.
 */
export function TabRowMeasure({ tabs, measureRef }: { tabs: readonly TabRowTab[]; measureRef: RefObject<HTMLDivElement | null> }): JSX.Element {
    const chevron = <span className="h-4 w-4 shrink-0" />;
    return (
        <div ref={measureRef} aria-hidden="true" data-testid="tab-row-measure"
            className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
            <div className="flex w-max">
                {tabs.map((t) => <span key={t.id} data-measure={`tab:${t.id}`} data-label={t.label} className={`${TAB_BASE} ${MEASURE_LABEL}`} />)}
                <span data-measure="more" data-label="More" className={`${TAB_BASE} gap-1 ${MEASURE_LABEL}`}>{chevron}</span>
                {tabs.map((t) => (
                    <span key={`trig-${t.id}`} data-measure={`trig:${t.id}`} data-label={t.label} className={`${TAB_BASE} gap-1 ${MEASURE_LABEL}`}>{chevron}</span>
                ))}
            </div>
        </div>
    );
}
