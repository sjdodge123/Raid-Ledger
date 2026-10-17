/**
 * ROK-1785 entry B: `players:header-cards` filler — the viewer's guild card(s)
 * above New Members. Members only (`mine` is membership-only). ROK-1786 (S2):
 * the GM post's headline sits under the guild name when there is one.
 */
import type { JSX } from 'react';
import type { MyGuild } from '@raid-ledger/contract';
import { NavChip } from '../../../components/ui/nav-chip';
import { guildRealm } from '../hub/wow-guild.helpers';
import { GuildCrest } from './guild-entry-bits';
import { guildHref, memberCountLabel, useMyGuilds } from './guild-queries';

function GuildCard({ guild }: { guild: MyGuild }): JSX.Element {
    const where = [guildRealm(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ');
    const headline = guild.gmPostHeadline?.trim() || null;
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-edge bg-panel p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="players-guild-card">
            <div className="flex min-w-0 items-center gap-3">
                <GuildCrest />
                <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-foreground">{guild.name}</p>
                    {headline && <p className="line-clamp-2 break-words text-sm text-secondary" data-testid="players-guild-headline">{headline}</p>}
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span>{where}</span>
                        <span data-testid="players-guild-member-count">{memberCountLabel(guild.memberCount)}</span>
                    </p>
                </div>
            </div>
            <div className="shrink-0"><NavChip to={guildHref(guild.id)} testId="players-guild-open">Open guild page</NavChip></div>
        </div>
    );
}

export function PlayersGuildCard(): JSX.Element | null {
    const guilds = useMyGuilds();
    if (guilds.length === 0) return null;
    return (
        <div className="space-y-3" data-testid="players-guild-cards">
            {guilds.map((g) => <GuildCard key={g.id} guild={g} />)}
        </div>
    );
}
