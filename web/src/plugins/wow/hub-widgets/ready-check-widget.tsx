/**
 * ROK-1926 (epic ROK-1905 W11 ★) — the Forever "Ready for next run" hub widget
 * body: the next upcoming guild event with planned content, its requirements,
 * a ready / not ready / unknown summary and one row per signup. Lazy-loaded by
 * `ready-check.register.ts`; renders nothing when no event has content.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { EventRaidReadiness, GuildEventCardDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { StatusChip } from '../../../components/ui/status-chip';
import { contentEvents, MATRIX_MQ } from './dungeon-quests.helpers';
import { formatStart, requirementsLine, summaryCounts } from './ready-check.helpers';
import { ReadyRows } from './ready-check-rows';
import { FreshnessFooter } from './freshness-footer';
import { useRaidReadiness } from './use-raid-readiness';

function Quiet({ children }: { children: string }): JSX.Element {
    return <p className="text-sm text-muted">{children}</p>;
}

function EventLine({ event }: { event: GuildEventCardDto }): JSX.Element {
    return (
        <div className="flex flex-wrap items-baseline gap-x-2">
            <Link to={`/events/${event.id}`} className="font-semibold text-foreground hover:underline">{event.title}</Link>
            <time dateTime={event.startTime} className="text-xs text-muted">{formatStart(event.startTime)}</time>
        </div>
    );
}

function Summary({ signups }: { signups: EventRaidReadiness['signups'] }): JSX.Element {
    const n = summaryCounts(signups);
    return (
        <div data-testid="ready-check-summary" className="flex flex-wrap gap-1.5">
            <StatusChip tone="success" title={`${n.pass} ready`}>✓ {n.pass}<span className="hidden md:inline">&nbsp;ready</span></StatusChip>
            <StatusChip tone="warning" title={`${n.fail} not ready`}>✗ {n.fail}<span className="hidden md:inline">&nbsp;not ready</span></StatusChip>
            <StatusChip tone="neutral" title={`${n.unknown} unknown`}>? {n.unknown}<span className="hidden md:inline">&nbsp;unknown</span></StatusChip>
        </div>
    );
}

function Loaded({ data, wide }: { data: EventRaidReadiness; wide: boolean }): JSX.Element {
    const req = requirementsLine(data.requirements);
    return (
        <>
            {req && <p data-testid="ready-check-requirements" className="text-xs text-muted">{req}</p>}
            {data.signups.length === 0 ? <Quiet>No one has signed up yet.</Quiet> : (
                <>
                    <Summary signups={data.signups} />
                    <ReadyRows signups={data.signups} requirements={data.requirements} wide={wide}
                        label={`${data.event.title} readiness`} />
                </>
            )}
            {data.freshness && <FreshnessFooter freshness={data.freshness} testId="ready-check-freshness" />}
        </>
    );
}

function Skeleton(): JSX.Element {
    return (
        <div data-testid="ready-check-loading" className="flex flex-col gap-1">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-md bg-panel" />)}
        </div>
    );
}

function ReadyCheckBody({ event, wide }: { event: GuildEventCardDto; wide: boolean }): JSX.Element {
    const readiness = useRaidReadiness(event.id);
    return (
        <section className="flex flex-col gap-2" aria-label={`${event.title} readiness`}>
            <EventLine event={event} />
            {readiness.isPending && <Skeleton />}
            {readiness.isError && <Quiet>Readiness isn&apos;t available for this event.</Quiet>}
            {readiness.data && <Loaded data={readiness.data} wide={wide} />}
        </section>
    );
}

/** The next content event's checklist; nothing when no upcoming event has content. */
export function ReadyCheckWidget({ raids }: HubWidgetCtx): JSX.Element | null {
    const wide = useMediaQuery(MATRIX_MQ);
    const event = contentEvents(raids.data, 1)[0];
    if (!event) return null;
    return <ReadyCheckBody event={event} wide={wide} />;
}

export default ReadyCheckWidget;
