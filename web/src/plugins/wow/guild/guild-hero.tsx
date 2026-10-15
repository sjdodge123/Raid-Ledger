/**
 * ROK-1785 — the guild hero (prototype `layout/GuildHero.tsx`): crest
 * placeholder, name, realm + region + faction, member count, and (ROK-1787)
 * the "Next raid" chip that jumps to the Raids tab. The progression badge
 * lands with S5.
 */
import type { JSX } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { GuildEventCardDto, GuildPage } from '@raid-ledger/contract';
import { NAV_CHIP_CLASS } from '../../../components/ui/nav-chip';
import { Pill } from './guild-bits';
import { signedShort, whenLabel } from './guild-raids.helpers';
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

/** Plain `<a href>`, not `NavChip`: `useHashTab` follows hashchange, which a router `<Link>` never fires. */
function NextRaidChip({ raid }: { raid: GuildEventCardDto }): JSX.Element {
    return (
        <a href="#raids" className={NAV_CHIP_CLASS} data-testid="guild-next-raid">
            <CalendarDaysIcon className="h-4 w-4 text-success" aria-hidden="true" />
            <span className="text-foreground">Next raid: {whenLabel(raid.startTime)}</span>
            <span className="text-muted">· {signedShort(raid)}</span>
        </a>
    );
}

export function GuildHero({ page, nextRaid }: { page: GuildPage; nextRaid: GuildEventCardDto | null }): JSX.Element {
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
            {(nextRaid || line) && (
                <div className="flex flex-col items-start gap-1 lg:items-end">
                    {nextRaid && <NextRaidChip raid={nextRaid} />}
                    {line && <p className="text-xs text-dim">{line}</p>}
                </div>
            )}
        </header>
    );
}
