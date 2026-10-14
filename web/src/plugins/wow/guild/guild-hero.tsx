/**
 * ROK-1785 — the guild hero (prototype `layout/GuildHero.tsx`): crest
 * placeholder, name, realm + region + faction, member count. The progression
 * badge and "Next raid" chip land with the stories that own that data (S3/S5).
 */
import type { JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import { Pill } from './guild-bits';
import { crestInitials, guildRealm } from './guild-roster.helpers';

function Crest({ name }: { name: string }): JSX.Element {
    return (
        <div aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-edge-strong bg-surface text-xl font-bold text-secondary sm:h-20 sm:w-20 sm:text-2xl">
            {crestInitials(name)}
        </div>
    );
}

function HeroFacts({ page }: { page: GuildPage }): JSX.Element {
    const { guild } = page;
    const where = [guildRealm(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ');
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{where}</span>
            {guild.faction && <Pill tone="success">{guild.faction}</Pill>}
            <span data-testid="guild-member-count">{guild.memberCount} members</span>
        </div>
    );
}

function importLine(page: GuildPage): string | null {
    const at = page.guild.lastSnapshotAt;
    if (!at) return null;
    const when = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return page.importedBy ? `Last imported from LedgerLink ${when} by ${page.importedBy}` : `Last imported from LedgerLink ${when}`;
}

export function GuildHero({ page }: { page: GuildPage }): JSX.Element {
    const line = importLine(page);
    return (
        <header data-testid="guild-hero"
            className="mb-4 flex flex-col gap-4 rounded-xl border border-edge bg-panel p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
                <Crest name={page.guild.name} />
                <div className="min-w-0">
                    <h1 className="mb-2 break-words text-2xl font-bold text-foreground sm:text-3xl">{page.guild.name}</h1>
                    <HeroFacts page={page} />
                </div>
            </div>
            {line && <p className="text-xs text-dim">{line}</p>}
        </header>
    );
}
