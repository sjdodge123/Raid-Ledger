/**
 * ROK-1785: shared pieces of the guild entry points — the crest placeholder
 * and the guild link row (prototype `guild-nav-wireframes/guild-entries.tsx`).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import type { MyGuild } from '@raid-ledger/contract';
import { guildRealm } from '../hub/wow-guild.helpers';
import { guildHref } from './guild-queries';

export function GuildCrest({ small = false }: { small?: boolean }): JSX.Element {
    const box = small ? 'h-6 w-6' : 'h-12 w-12';
    return (
        <span className={`flex shrink-0 items-center justify-center rounded-lg border border-edge-strong bg-overlay text-success ${box}`} aria-hidden="true">
            <ShieldCheckIcon className={small ? 'h-4 w-4' : 'h-7 w-7'} />
        </span>
    );
}

function rowMeta(guild: MyGuild): string {
    return [guild.rankName, guildRealm(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ');
}

function GuildLinkRow({ guild, onNavigate }: { guild: MyGuild; onNavigate?: (() => void) | undefined }): JSX.Element {
    return (
        <Link to={guildHref(guild.id)} onClick={onNavigate} data-testid="guild-entry-row"
            className="flex min-h-[44px] items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-overlay">
            <GuildCrest small />
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{guild.name}</span>
                <span className="block truncate text-xs text-muted">{rowMeta(guild)}</span>
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
