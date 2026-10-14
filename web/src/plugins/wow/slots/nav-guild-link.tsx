/**
 * ROK-1785 entry E (tablet + desktop): `nav:primary-links` filler. One guild →
 * a "Guild" link; two or more → a small menu (UserMenu's dropdown pattern,
 * design-system §4.14); none → nothing. The header shows the slot from md:
 * 768–1023px renders an icon-only shield (the core links already fill that
 * row), ≥1024px the "Guild" text. Both keep the accessible name "Guild".
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDownIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import type { MyGuild } from '@raid-ledger/contract';
import { navClass } from '../../../components/layout/nav-class';
import { Button } from '../../../components/ui/button';
import { GuildRows } from './guild-entry-bits';
import { guildHref, useMyGuilds } from './guild-queries';

/**
 * Shield below lg, "Guild" from lg. The negative margin + padding gives the
 * icon a 44px target without widening the md row beyond the 20px glyph.
 */
const RESPONSIVE_HIT = 'inline-flex items-center -m-3 p-3 lg:m-0 lg:p-0';

function GuildLabel(): JSX.Element {
    return (
        <>
            <ShieldCheckIcon className="h-5 w-5 lg:hidden" aria-hidden="true" data-testid="nav-guild-icon" />
            <span className="hidden lg:inline">Guild</span>
        </>
    );
}

function useDismiss(ref: React.RefObject<HTMLDivElement | null>, isOpen: boolean, close: () => void): void {
    useEffect(() => {
        if (!isOpen) return undefined;
        const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
        const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [ref, isOpen, close]);
}

function GuildMenu({ guilds, active }: { guilds: MyGuild[]; active: boolean }): JSX.Element {
    const [isOpen, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const close = useCallback(() => setOpen(false), []);
    useDismiss(ref, isOpen, close);
    return (
        <div ref={ref} className="relative">
            <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={isOpen} aria-haspopup="true"
                aria-current={active ? 'page' : undefined} aria-label="Guild" title="Your guilds" data-testid="nav-guild-menu-trigger">
                <span className={`flex items-center gap-1 text-base ${navClass(active ? 'on' : '', 'on')}`}>
                    <GuildLabel /> <ChevronDownIcon className={`hidden h-4 w-4 transition-transform lg:block ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </span>
            </Button>
            {isOpen && (
                <div role="menu" aria-label="Your guilds" data-testid="nav-guild-menu"
                    className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-edge bg-surface shadow-xl">
                    <GuildRows guilds={guilds} onNavigate={close} />
                </div>
            )}
        </div>
    );
}

export function NavGuildLink({ pathname }: { pathname?: string }): JSX.Element | null {
    const guilds = useMyGuilds();
    const [first] = guilds;
    if (!first) return null;
    const current = pathname ?? '';
    if (guilds.length === 1) {
        const to = guildHref(first.id);
        return (
            <Link to={to} className={`${RESPONSIVE_HIT} ${navClass(current, to)}`} aria-label="Guild" title={first.name} data-testid="nav-guild-link">
                <GuildLabel />
            </Link>
        );
    }
    return <GuildMenu guilds={guilds} active={current.startsWith('/guilds/')} />;
}
