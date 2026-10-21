/**
 * ROK-1875 (operator ruling 2026-10-20) — the header "Hubs" item, from 768px.
 * No hubs, or the list still loading / failed → a plain link to `/hubs` (D1),
 * so the item never flashes away. One or more → a design-system §4.14 menu
 * (D7): "Your hubs" (one row per hub, any kind, each with its kind chip), a
 * separator, then "Browse all hubs →". Arrows wrap, Home/End jump, the first
 * item takes focus on open; Esc / Tab / an outside press / a pick close it.
 */
import { useCallback, useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { MyGuild } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { onMenuKeyDown, useFocusFirstItem } from '../../ui/menu-keys';
import { navClass } from '../nav-class';
import { GuildRows } from './hub-entry-bits';
import { HubsCircle } from './hubs-circle';
import { HUBS_PATH, useMyGuildsQuery } from './my-hubs-queries';
import { isHubsNavActive } from './use-hub-nav-active';

type Close = (restoreFocus?: boolean) => void;

/** Closes the menu on a mousedown outside `root` while it is open. */
function useOutsidePressClose(root: RefObject<HTMLDivElement | null>, isOpen: boolean, close: Close): void {
    useEffect(() => {
        if (!isOpen) return undefined;
        const onDown = (e: MouseEvent): void => {
            if (e.target instanceof Node && root.current?.contains(e.target)) return;
            close();
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [root, isOpen, close]);
}

interface PopoverProps { id: string; hubs: MyGuild[]; close: Close }

function HubsMenuPopover({ id, hubs, close }: PopoverProps): JSX.Element {
    const menuRef = useRef<HTMLDivElement>(null);
    useFocusFirstItem(menuRef, true);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
        // Focus goes back to the trigger first, so Tab's default move continues from it.
        else if (e.key === 'Tab') close(true);
        else onMenuKeyDown(e);
    };
    return (
        <div ref={menuRef} id={id} role="menu" aria-label="Hubs" onKeyDown={onKeyDown} data-testid="nav-hubs-menu"
            className="absolute left-0 top-full z-50 mt-2 flex max-h-[calc(100dvh-5rem)] w-72 flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-xl">
            {/* Codex r2: a long hub list scrolls inside the menu; "Browse all hubs" stays pinned below it. */}
            <div role="presentation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="nav-hubs-menu-list">
                <p role="presentation" className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Your hubs</p>
                <GuildRows guilds={hubs} onNavigate={() => close()} role="menuitem" />
            </div>
            <div role="separator" className="shrink-0 border-t border-edge" />
            <Link to={HUBS_PATH} role="menuitem" onClick={() => close()} data-testid="nav-hubs-browse-all"
                className="flex min-h-[44px] shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-overlay hover:text-foreground focus-visible:bg-overlay focus-visible:outline-none">
                Browse all hubs <span aria-hidden="true">→</span>
            </Link>
        </div>
    );
}

/**
 * The trigger / link face (operator ruling 2026-10-21): the shared green circle, then "Hubs" from lg. 768–1023px
 * shows the circle alone so the tight header fits. Not sr-only + lg:not-sr-only — index.css's unlayered .sr-only
 * beats Tailwind's layered utilities — so the label hides with `hidden lg:inline` and the host's aria-label names it.
 */
function HubsFace({ active }: { active: boolean }): JSX.Element {
    return (
        <>
            <HubsCircle size="inline" active={active} testId="nav-hubs-circle" />
            <span className="hidden lg:inline" aria-hidden="true">Hubs</span>
        </>
    );
}

function HubsMenu({ hubs, active }: { hubs: MyGuild[]; active: boolean }): JSX.Element {
    const [isOpen, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const close = useCallback<Close>((restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);
    useOutsidePressClose(rootRef, isOpen, close);
    return (
        <div ref={rootRef} className="relative">
            <Button ref={triggerRef} variant="ghost" size="sm" className="md:px-1 lg:px-3" aria-label="Hubs" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={isOpen}
                aria-controls={isOpen ? menuId : undefined} aria-current={active ? 'page' : undefined} data-testid="nav-hubs-menu-trigger">
                <span className={`flex items-center gap-1.5 text-base ${navClass(active ? 'on' : '', 'on')}`}>
                    <HubsFace active={active} />
                    <ChevronDownIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </span>
            </Button>
            {isOpen && <HubsMenuPopover id={menuId} hubs={hubs} close={close} />}
        </div>
    );
}

/** The header Hubs item for a signed-in viewer: a plain link (D1) or the Hubs menu (D7). */
export function HubsNavItem({ pathname }: { pathname: string }): JSX.Element {
    const hubs = useMyGuildsQuery().data?.guilds ?? [];
    const active = isHubsNavActive(pathname);
    if (hubs.length > 0) return <HubsMenu hubs={hubs} active={active} />;
    return (
        <Link to={HUBS_PATH} aria-label="Hubs" aria-current={active ? 'page' : undefined} data-testid="nav-hubs-link"
            className={`flex items-center gap-1.5 ${navClass(active ? 'on' : '', 'on')}`}><HubsFace active={active} /></Link>
    );
}
