/**
 * ROK-1785/ROK-1830 — the hub hero (prototype `layout/GuildHero.tsx`): crest
 * (ROK-1814; initials when none), name, the module's facts pills, member count, and the
 * "Next raid" chip that jumps to the module's events tab. Everything
 * game-specific (realm, faction, the LedgerLink import line) arrives through
 * the hub module's `heroPills` / `heroNote`.
 *
 * ROK-1884 — below `lg` the header is a grid: crest · one-line title · actions
 * on the first row, then the chip row (and blurb / next-raid / note) full
 * width beneath, so the chips never crowd the title or the buttons. The
 * wrappers are `display: contents` there and turn back into the original
 * flex boxes at `lg`, which stays as it was.
 */
import type { JSX, ReactNode } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { GuildEventCardDto } from '@raid-ledger/contract';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { NAV_CHIP_CLASS } from '../ui/nav-chip';
import { hubCopy } from './hub-copy';
import { signedShort, whenLabel } from './events/guild-raids.helpers';
import { memberCountLabel } from '../layout/hub-nav/my-hubs-queries';
import { HubCrest } from './crest/hub-crest';

function HeroFacts({ ctx, module: mod }: { ctx: HubCtx; module: HubModule | undefined }): JSX.Element {
    return (
        <div className="col-span-full flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="hub-hero-chips">
            {(mod?.heroPills ?? []).map((Pill, i) => <Pill key={`hero-pill-${i}`} {...ctx} />)}
            <span data-testid="guild-member-count">{memberCountLabel(ctx.page.guild.memberCount)}</span>
        </div>
    );
}

/** Plain `<a href>`, not `NavChip`: `useHashTab` follows hashchange, which a router `<Link>` never fires. */
function NextRaidChip({ raid, tab, label }: { raid: GuildEventCardDto; tab: string; label: string }): JSX.Element {
    return (
        <a href={`#${tab}`} className={`${NAV_CHIP_CLASS} max-w-full`} data-testid="guild-next-raid">
            <CalendarDaysIcon className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            {/* One inline text run, so a narrow screen wraps it as a sentence instead of splitting the count into its own flex column. */}
            <span className="min-w-0">
                <span className="text-foreground">{label}: {whenLabel(raid.startTime)}</span>{' '}
                <span className="whitespace-nowrap text-muted">· {signedShort(raid)}</span>
            </span>
        </a>
    );
}

/** Below `lg`: crest | title | actions, then full-width rows. At `lg`: the original flex row. */
const HERO_CLASS =
    'mb-4 grid items-center gap-x-4 gap-y-2 rounded-xl border border-edge bg-panel p-4 sm:p-6 lg:flex lg:flex-row lg:justify-between lg:gap-4';

/** One line with an ellipsis below `lg`; wraps as before at `lg`. */
const TITLE_CLASS =
    'col-start-2 row-start-1 min-w-0 truncate text-2xl font-bold text-foreground sm:text-3xl lg:mb-2 lg:overflow-visible lg:whitespace-normal lg:break-words';

/**
 * The header's grid tracks: a third (actions) column only when there is an action, so a
 * viewer without one doesn't lose 16px of title to an empty column's gap. Keep the track
 * explicit — `col-span-full` (1 / -1) spans the explicit grid only.
 */
function heroClass(hasAction: boolean): string {
    return `${HERO_CLASS} ${hasAction ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)]'}`;
}

interface HubHeroProps {
    ctx: HubCtx;
    module: HubModule | undefined;
    nextRaid: GuildEventCardDto | null;
    /** The hub's single settings entry point — only a Leader/admin gets one (ROK-1830 S4). */
    action?: ReactNode;
}

export function HubHero({ ctx, module: mod, nextRaid, action = null }: HubHeroProps): JSX.Element {
    const line = mod?.heroNote ? mod.heroNote(ctx) : null;
    // ROK-1870: a community hub's leader-edited blurb sits under the name (the settings copy promises it here).
    const blurb = ctx.page.community?.blurb ?? null;
    // Core always has an Events tab now (ROK-1830 S3c), so the chip always has
    // somewhere to land; a module only redirects it (WoW → its Raids tab).
    const jumpTab = mod?.eventsJumpTab ?? 'events';
    const chip = nextRaid !== null ? <NextRaidChip raid={nextRaid} tab={jumpTab} label={hubCopy(ctx.page.guild.kind).nextEventLabel} /> : null;
    return (
        <header data-testid="guild-hero" className={heroClass(Boolean(action))}>
            <div className="contents lg:flex lg:min-w-0 lg:items-center lg:gap-4" data-testid="hub-hero-identity">
                <HubCrest crest={ctx.page.guild.crest} name={ctx.page.guild.name} size="hero" className="col-start-1 row-start-1" />
                <div className="contents lg:block lg:min-w-0">
                    <h1 className={TITLE_CLASS} title={ctx.page.guild.name}>{ctx.page.guild.name}</h1>
                    {blurb && <p className="col-span-full break-words text-sm text-secondary lg:mb-2" data-testid="hub-hero-blurb">{blurb}</p>}
                    <HeroFacts ctx={ctx} module={mod} />
                </div>
            </div>
            {(chip || line || action) && (
                <div className="contents lg:flex lg:flex-col lg:items-end lg:gap-2" data-testid="hub-hero-side">
                    {chip && <div className="col-span-full lg:contents">{chip}</div>}
                    {line && <p className="col-span-full text-xs text-dim">{line}</p>}
                    {action && <div className="col-start-3 row-start-1 lg:contents" data-testid="hub-hero-actions">{action}</div>}
                </div>
            )}
        </header>
    );
}
