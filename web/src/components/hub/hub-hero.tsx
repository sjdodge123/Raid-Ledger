/**
 * ROK-1785/ROK-1830 — the hub hero (prototype `layout/GuildHero.tsx`): crest
 * placeholder, name, the module's facts pills, member count, and the
 * "Next raid" chip that jumps to the module's events tab. Everything
 * game-specific (realm, faction, the LedgerLink import line) arrives through
 * the hub module's `heroPills` / `heroNote`.
 */
import type { JSX } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { GuildEventCardDto } from '@raid-ledger/contract';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { NAV_CHIP_CLASS } from '../ui/nav-chip';
import { signedShort, whenLabel } from './events/guild-raids.helpers';

/** Up to two initials for the crest placeholder ("Iron Vanguard" → "IV"). */
export function crestInitials(name: string): string {
    const letters = name.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase());
    return letters.slice(0, 2).join('') || '?';
}

function Crest({ name }: { name: string }): JSX.Element {
    return (
        <div aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-edge-strong bg-surface text-xl font-bold text-secondary sm:h-20 sm:w-20 sm:text-2xl">
            {crestInitials(name)}
        </div>
    );
}

function HeroFacts({ ctx, module: mod }: { ctx: HubCtx; module: HubModule | undefined }): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {(mod?.heroPills ?? []).map((Pill, i) => <Pill key={`hero-pill-${i}`} {...ctx} />)}
            <span data-testid="guild-member-count">{ctx.page.guild.memberCount} members</span>
        </div>
    );
}

/** Plain `<a href>`, not `NavChip`: `useHashTab` follows hashchange, which a router `<Link>` never fires. */
function NextRaidChip({ raid }: { raid: GuildEventCardDto }): JSX.Element {
    return (
        <a href="#raids" className={`${NAV_CHIP_CLASS} max-w-full`} data-testid="guild-next-raid">
            <CalendarDaysIcon className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            {/* One inline text run, so a narrow screen wraps it as a sentence instead of splitting the count into its own flex column. */}
            <span className="min-w-0">
                <span className="text-foreground">Next raid: {whenLabel(raid.startTime)}</span>{' '}
                <span className="whitespace-nowrap text-muted">· {signedShort(raid)}</span>
            </span>
        </a>
    );
}

interface HubHeroProps {
    ctx: HubCtx;
    module: HubModule | undefined;
    nextRaid: GuildEventCardDto | null;
}

export function HubHero({ ctx, module: mod, nextRaid }: HubHeroProps): JSX.Element {
    const line = mod?.heroNote ? mod.heroNote(ctx) : null;
    return (
        <header data-testid="guild-hero"
            className="mb-4 flex flex-col gap-4 rounded-xl border border-edge bg-panel p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
                <Crest name={ctx.page.guild.name} />
                <div className="min-w-0">
                    <h1 className="mb-2 break-words text-2xl font-bold text-foreground sm:text-3xl">{ctx.page.guild.name}</h1>
                    <HeroFacts ctx={ctx} module={mod} />
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
