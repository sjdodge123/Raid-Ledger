/**
 * ROK-1924 — one upcoming event in the Dungeon quests widget: a header linking
 * to the event page, then its readiness matrix (or compact list), the
 * pre-launch "no quest data yet" note, or a quiet "not available" line.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { EventQuestReadinessDto, GuildEventCardDto } from '@raid-ledger/contract';
import { useQuestReadiness } from './use-quest-readiness';
import { QuestCompactList, QuestMatrix } from './dungeon-quests-matrix';

function formatWhen(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function EventHeader({ event }: { event: GuildEventCardDto }): JSX.Element {
    const instances = (event.contentInstances ?? []).map((i) => i.name).join(', ');
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <Link to={`/events/${event.id}`} className="text-sm font-semibold text-foreground hover:underline">{event.title}</Link>
            <span className="text-xs text-muted">{formatWhen(event.startTime)}{instances ? ` · ${instances}` : ''}</span>
        </div>
    );
}

/** The expected launch-day state: content is planned, the quest dataset is not imported yet. */
function NoQuestData(): JSX.Element {
    return (
        <div className="rounded-lg border border-dashed border-edge bg-panel p-3">
            <p className="text-sm font-medium text-foreground">Quest data for Forever dungeons arrives after launch</p>
            <p className="mt-0.5 text-xs text-muted">This event&apos;s dungeons are set. Once the Forever quest list is imported, each signup&apos;s quests and prerequisites show up here.</p>
        </div>
    );
}

function Quiet({ children }: { children: string }): JSX.Element {
    return <p className="text-xs text-muted">{children}</p>;
}

function ReadinessBody({ data, title, wide }: { data: EventQuestReadinessDto; title: string; wide: boolean }): JSX.Element {
    if (data.quests.length === 0) return <NoQuestData />;
    if (data.signups.length === 0) return <Quiet>No signups yet.</Quiet>;
    const Body = wide ? QuestMatrix : QuestCompactList;
    return <Body quests={data.quests} signups={data.signups} label={`${title} quest readiness`} />;
}

/** One event: header + readiness; a 403/404/failed read is a quiet line, never a crash. */
export function EventQuestBlock({ event, wide }: { event: GuildEventCardDto; wide: boolean }): JSX.Element {
    const readiness = useQuestReadiness(event.id);
    return (
        <section className="flex flex-col gap-2" aria-label={event.title}>
            <EventHeader event={event} />
            {readiness.isPending && <Quiet>Loading quests…</Quiet>}
            {readiness.isError && <Quiet>Quest readiness is not available for this event.</Quiet>}
            {readiness.data && <ReadinessBody data={readiness.data} title={event.title} wide={wide} />}
        </section>
    );
}
