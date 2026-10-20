/**
 * ROK-1785/ROK-1870: shared pieces of the hub entry points — the crest
 * placeholder and the hub link row (prototype `guild-nav-wireframes/guild-entries.tsx`).
 * Core since D9; the WoW plugin re-exports them for its own cards.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import type { MyGuild } from '@raid-ledger/contract';
import { guildHref } from './my-hubs-queries';

export function GuildCrest({ small = false }: { small?: boolean }): JSX.Element {
    const box = small ? 'h-6 w-6' : 'h-12 w-12';
    return (
        <span className={`flex shrink-0 items-center justify-center rounded-lg border border-edge-strong bg-overlay text-success ${box}`} aria-hidden="true">
            <ShieldCheckIcon className={small ? 'h-4 w-4' : 'h-7 w-7'} />
        </span>
    );
}

/** ROK-1831 D6: the hub game's icon when the API sends one, else the generic crest. */
export function GuildRowIcon({ guild }: { guild: MyGuild }): JSX.Element {
    if (!guild.gameIconUrl) return <GuildCrest small />;
    return <img src={guild.gameIconUrl} alt="" aria-hidden="true" data-testid="guild-entry-game-icon"
        className="h-6 w-6 shrink-0 rounded-lg border border-edge-strong object-cover" />;
}

/** "whitemane" → "Whitemane"; the API's display name wins when sent. */
function realmOf(guild: MyGuild): string | null {
    if (guild.realmName) return guild.realmName;
    if (!guild.realmSlug) return null;
    return guild.realmSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Rank · realm · region for a guild or server; a community hub has no realm or region to show. */
function hubRowMeta(guild: MyGuild): string {
    if (guild.kind === 'game_community') return [guild.rankName, 'Community hub'].filter(Boolean).join(' · ');
    return [guild.rankName, realmOf(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ');
}

function GuildLinkRow({ guild, onNavigate }: { guild: MyGuild; onNavigate?: (() => void) | undefined }): JSX.Element {
    return (
        <Link to={guildHref(guild.id)} onClick={onNavigate} data-testid="guild-entry-row"
            className="flex min-h-[44px] items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-overlay">
            <GuildRowIcon guild={guild} />
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{guild.name}</span>
                <span className="block truncate text-xs text-muted">{hubRowMeta(guild)}</span>
            </span>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        </Link>
    );
}

export function GuildRows({ guilds, onNavigate }: { guilds: MyGuild[]; onNavigate?: (() => void) | undefined }): JSX.Element {
    return (
        <ul className="divide-y divide-edge-subtle">
            {guilds.map((g) => <li key={g.id}><GuildLinkRow guild={g} onNavigate={onNavigate} /></li>)}
        </ul>
    );
}
