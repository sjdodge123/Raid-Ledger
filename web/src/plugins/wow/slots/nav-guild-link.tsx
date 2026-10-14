/**
 * ROK-1785 entry E (desktop): `nav:primary-links` filler. One guild → a
 * "Guild" link; two or more → a small menu (UserMenu's dropdown pattern,
 * design-system §4.14); none → nothing.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { MyGuild } from '@raid-ledger/contract';
import { navClass } from '../../../components/layout/nav-class';
import { GuildRows } from './guild-entry-bits';
import { guildHref, useMyGuilds } from './guild-queries';

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
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={isOpen} aria-haspopup="true"
                className={`flex items-center gap-1 ${navClass(active ? 'on' : '', 'on')}`} data-testid="nav-guild-menu-trigger">
                Guild <ChevronDownIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
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
        return <Link to={to} className={navClass(current, to)} data-testid="nav-guild-link">Guild</Link>;
    }
    return <GuildMenu guilds={guilds} active={current.startsWith('/guilds/')} />;
}
