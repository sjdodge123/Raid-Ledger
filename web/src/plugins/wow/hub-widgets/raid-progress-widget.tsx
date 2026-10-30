/**
 * ROK-1917 (W10) — WoW: Forever "Raid progress" Overview card body: a
 * `text-3xl` "N bosses killed" headline over "from M pulls in LedgerLink raid
 * exports", the boss list (`raid-progress-rows.tsx`) and the shared
 * `FreshnessFooter` dated by the latest pull. No pulls yet shows the quiet §4.5
 * line (AC7). Core draws the `WidgetCard` chrome; the registration
 * (`raid-progress.register.ts`) gates it to members + staff.
 */
import type { JSX } from 'react';
import type { HubFactFreshness, WowRosterRaidProgressDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { FreshnessFooter } from './freshness-footer';
import { BossList } from './raid-progress-rows';
import { RAID_PROGRESS_EMPTY_COPY, killedLabel, pullsLine } from './raid-progress.helpers';
import { useRosterInsights } from './use-roster-insights';

function freshnessOf(progress: WowRosterRaidProgressDto | undefined): HubFactFreshness | null {
    const asOf = progress?.lastPullAt ?? null;
    return asOf === null ? null : { source: 'addon', asOf };
}

function Headline({ progress }: { progress: WowRosterRaidProgressDto }): JSX.Element {
    return (
        <div className="mb-2">
            <p data-testid="raid-progress-killed" className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold leading-none text-foreground">{progress.killedCount}</span>
                <span className="text-sm text-muted">{killedLabel(progress.killedCount)}</span>
            </p>
            <p data-testid="raid-progress-pulls" className="mt-0.5 text-xs text-dim">{pullsLine(progress.pullCount)}</p>
        </div>
    );
}

/** The Raid progress widget body (lazy-loaded). */
export default function RaidProgressWidget({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element {
    const { data, isPending, isError } = useRosterInsights(page.guild.id, false);
    if (isPending) return <div className="h-24 animate-pulse rounded-md bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load raid progress.</p>;
    const progress = data.raidProgress;
    const footer = <FreshnessFooter freshness={freshnessOf(progress)} />;
    if (progress === undefined || progress.pullCount === 0) {
        return (
            <div data-testid="raid-progress-empty" className="flex flex-col">
                <p className="text-sm text-muted">{RAID_PROGRESS_EMPTY_COPY}</p>
                {footer}
            </div>
        );
    }
    return (
        <div data-testid="raid-progress" className="flex flex-col">
            <Headline progress={progress} />
            <BossList bosses={progress.bosses} />
            {footer}
        </div>
    );
}
