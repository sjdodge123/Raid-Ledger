/**
 * ROK-1787 — guild events (prototype `GuildEvents.tsx`). Upcoming: raised
 * cards with a date tile, signups vs needed and the viewer's own status.
 * Recent: a quieter list with attendance. Compact = the Overview card (two of
 * each + an "All events" jump); full = the Raids tab section.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { GuildEventCardDto, GuildRaidsDto, GuildRecentEventDto } from '@raid-ledger/contract';
import { FOCUS_RING } from '../../ui/form-classes';
import { Card, Pill, SectionTitle, WidgetCard } from '../hub-bits';
import { GuildMeter } from './guild-meter';
import { dateTile, dayLabel, percent, signupLabel, timeRange, whenLabel } from './guild-raids.helpers';
import { JumpLink, QuietEmpty } from '../card-bits';

const SUBHEAD = 'mb-2 text-xs font-semibold uppercase tracking-wider text-muted';
const COMPACT_COUNT = 2;
const SIGN_UP_LINK = `inline-flex items-center rounded-lg border border-edge bg-panel px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-overlay ${FOCUS_RING}`;

function StatusMark({ e }: { e: GuildEventCardDto }): JSX.Element {
    if (e.viewerStatus === 'signed_up') return <Pill tone="success">You&apos;re signed up</Pill>;
    if (e.viewerStatus === 'tentative') return <Pill tone="warning">You&apos;re tentative</Pill>;
    return <Link to={`/events/${e.id}`} className={SIGN_UP_LINK} aria-label={`Sign up for ${e.title}`}>Sign up</Link>;
}

function SignupMeter({ e }: { e: GuildEventCardDto }): JSX.Element {
    return (
        <div className="flex items-center gap-2">
            {e.needed !== null && (
                <div className="w-24"><GuildMeter pct={percent(e.signupCount, e.needed)} label={`${e.title}: ${signupLabel(e)}`} /></div>
            )}
            <span className="text-xs text-muted">{signupLabel(e)}</span>
        </div>
    );
}

function UpcomingCard({ e }: { e: GuildEventCardDto }): JSX.Element {
    const tile = dateTile(e.startTime);
    return (
        <li data-testid="guild-upcoming-event" className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-3">
            <div aria-hidden="true" className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-edge bg-panel leading-tight">
                <span className="text-[0.625rem] font-semibold uppercase text-muted">{tile.month}</span>
                <span className="text-lg font-bold text-foreground">{tile.day}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                    <Link to={`/events/${e.id}`} className={`block truncate rounded-sm font-semibold text-foreground hover:underline ${FOCUS_RING}`}>{e.title}</Link>
                    <span className="text-xs text-muted">{dayLabel(e.startTime)} · {timeRange(e.startTime, e.endTime)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <SignupMeter e={e} />
                    <StatusMark e={e} />
                </div>
            </div>
        </li>
    );
}

function recentLabel(e: GuildRecentEventDto): string {
    if (e.attended === null) return `${e.signedUp} signed up · attendance not recorded`;
    return `${e.attended} of ${e.signedUp} attended (${percent(e.attended, e.signedUp)}%)`;
}

function RecentRow({ e }: { e: GuildRecentEventDto }): JSX.Element {
    return (
        <li data-testid="guild-recent-event" className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-edge-subtle py-2 text-sm last:border-b-0">
            <span className="min-w-0 text-secondary">
                <Link to={`/events/${e.id}`} className={`rounded-sm font-medium hover:underline ${FOCUS_RING}`}>{e.title}</Link>{' '}
                <span className="text-xs text-dim">· {whenLabel(e.startTime)}</span>
            </span>
            <span className="text-xs text-muted">{recentLabel(e)}</span>
        </li>
    );
}

function EventLists({ raids, compact }: { raids: GuildRaidsDto; compact: boolean }): JSX.Element {
    const upcoming = compact ? raids.upcoming.slice(0, COMPACT_COUNT) : raids.upcoming;
    const recent = compact ? raids.recent.slice(0, COMPACT_COUNT) : raids.recent;
    return (
        <>
            <h4 className={SUBHEAD}>Upcoming</h4>
            {upcoming.length === 0
                ? <QuietEmpty>No upcoming guild events. A guild editor can pick this guild when creating an event.</QuietEmpty>
                : <ul aria-label="Upcoming guild events" className="mb-5 flex flex-col gap-2">{upcoming.map((e) => <UpcomingCard key={e.id} e={e} />)}</ul>}
            <h4 className={SUBHEAD}>Recent</h4>
            {recent.length === 0
                ? <QuietEmpty>No guild events in the last 8 weeks.</QuietEmpty>
                : <Card className="bg-panel py-1"><ul aria-label="Recent guild events">{recent.map((e) => <RecentRow key={e.id} e={e} />)}</ul></Card>}
        </>
    );
}

interface GuildEventsProps {
    raids: GuildRaidsDto;
    compact?: boolean;
    /** Tab id the compact card's "All events" jumps to; no value = no jump link. */
    jumpTab?: string | null;
}

export function GuildEvents({ raids, compact = false, jumpTab = null }: GuildEventsProps): JSX.Element {
    if (compact) {
        const action = jumpTab === null ? undefined : <JumpLink testId="guild-all-events" href={`#${jumpTab}`}>All events</JumpLink>;
        return (
            <WidgetCard id="guild-events" title="Upcoming & recent events" action={action}>
                <EventLists raids={raids} compact />
            </WidgetCard>
        );
    }
    return (
        <section id="guild-events" data-testid="guild-events-full" className="scroll-mt-4">
            <SectionTitle title="Guild events" blurb="Raids and runs scheduled for this guild." />
            <EventLists raids={raids} compact={false} />
        </section>
    );
}
