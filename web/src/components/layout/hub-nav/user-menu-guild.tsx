/**
 * ROK-1785 entry E (tablet), core since ROK-1870 D9 — one item per guild at
 * the top of the header user menu, 768–1023px only. From 1024px the header
 * bar's "Guild" link is the entry, so this hides at `lg`; below 768px the
 * user menu is not rendered and the drawer's "Your guild" block takes over.
 * Non-members render nothing. Picking a guild closes the menu.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { guildHref, useMyGuilds } from './my-hubs-queries';

export function UserMenuGuild({ onClose }: { onClose?: () => void }): JSX.Element | null {
    const guilds = useMyGuilds();
    if (guilds.length === 0) return null;
    return (
        <div className="lg:hidden" data-testid="user-menu-guild">
            {guilds.map((g) => (
                <Link key={g.id} to={guildHref(g.id)} onClick={onClose} title={g.name} data-testid="user-menu-guild-item"
                    className="flex items-center gap-2 px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors">
                    <ShieldCheckIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{g.name}</span>
                </Link>
            ))}
        </div>
    );
}
