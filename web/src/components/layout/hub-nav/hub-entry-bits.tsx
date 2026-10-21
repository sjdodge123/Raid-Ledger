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
import { HubKindChip } from './hub-kind-chip';

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

/**
 * Rank · realm · region for a WoW guild. Server and community hubs carry no
 * real realm/region (their `region` is the kind word), and the kind chip
 * already says it, so only the rank (ROK-1875 D6; operator 2026-10-21: the kind
 * showed twice on server rows).
 */
function hubRowMeta(guild: MyGuild): string {
    if (guild.kind !== 'wow_guild') return guild.rankName ?? '';
    return [guild.rankName, realmOf(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ');
}

/** `menuitem` when the rows sit in a `role="menu"` (the header Hubs menu, ROK-1875 D7). */
type RowRole = 'menuitem' | undefined;

interface RowProps { guild: MyGuild; onNavigate?: (() => void) | undefined; role?: RowRole }

function GuildLinkRow({ guild, onNavigate, role }: RowProps): JSX.Element {
    const meta = hubRowMeta(guild);
    return (
        <Link to={guildHref(guild.id)} onClick={onNavigate} data-testid="guild-entry-row" role={role}
            className="flex min-h-[44px] items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-overlay focus-visible:bg-overlay focus-visible:outline-none">
            <GuildRowIcon guild={guild} />
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{guild.name}</span>
                {meta && <span className="block truncate text-xs text-muted">{meta}</span>}
            </span>
            <HubKindChip kind={guild.kind} />
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        </Link>
    );
}

/** One row per hub: icon · name over meta · kind chip · chevron. Pass `role="menuitem"` inside a menu. */
export function GuildRows({ guilds, onNavigate, role }: { guilds: MyGuild[]; onNavigate?: (() => void) | undefined; role?: RowRole }): JSX.Element {
    return (
        <ul className="divide-y divide-edge-subtle" role={role ? 'none' : undefined}>
            {guilds.map((g) => <li key={g.id} role={role ? 'none' : undefined}><GuildLinkRow guild={g} onNavigate={onNavigate} role={role} /></li>)}
        </ul>
    );
}
