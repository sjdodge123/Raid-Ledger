/**
 * ROK-1785 entry F (game page): `game-detail:sections` filler — "Guilds" of
 * this game the viewer can open. Renders nothing when there are none.
 */
import type { JSX } from 'react';
import type { MyGuild } from '@raid-ledger/contract';
import { NavChip } from '../../../components/ui/nav-chip';
import { GuildCrest } from './guild-entry-bits';
import { guildHref, memberCountLabel, useGameGuilds } from './guild-queries';

function GuildRow({ guild }: { guild: MyGuild }): JSX.Element {
    return (
        <li className="flex items-center gap-3 border-b border-edge-subtle py-3 last:border-b-0" data-testid="game-guild-row">
            <GuildCrest small />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{guild.name}</span>
            <span className="hidden text-sm text-muted sm:inline">{memberCountLabel(guild.memberCount)}</span>
            <NavChip to={guildHref(guild.id)}>View</NavChip>
        </li>
    );
}

export function GameDetailGuilds({ gameId }: { gameId?: number; gameSlug?: string }): JSX.Element | null {
    const guilds = useGameGuilds(gameId);
    if (guilds.length === 0) return null;
    return (
        <section className="mb-8 rounded-xl border border-edge bg-panel p-4" data-testid="game-detail-guilds">
            <h2 className="mb-2 text-lg font-semibold text-foreground">Guilds</h2>
            <ul>{guilds.map((g) => <GuildRow key={g.id} guild={g} />)}</ul>
        </section>
    );
}
