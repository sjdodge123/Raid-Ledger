/**
 * ROK-1785 entry E (phone): `nav:drawer-top` filler — the "Your guild" block
 * at the top of the More drawer. Tapping a guild closes the drawer.
 */
import type { JSX } from 'react';
import { GuildRows } from './guild-entry-bits';
import { useMyGuilds } from './guild-queries';

export function DrawerYourGuild({ onClose }: { onClose?: () => void }): JSX.Element | null {
    const guilds = useMyGuilds();
    if (guilds.length === 0) return null;
    return (
        <div className="border-b border-edge bg-success/10" data-testid="drawer-your-guild">
            <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {guilds.length > 1 ? 'Your guilds' : 'Your guild'}
            </p>
            <GuildRows guilds={guilds} onNavigate={onClose} />
        </div>
    );
}
