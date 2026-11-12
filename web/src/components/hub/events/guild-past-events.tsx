/**
 * ROK-2185 item 3 (operator ruling Q4 = A) — the Events tab's Recent list,
 * paging back through the hub's full history. The first rows are the raids
 * payload's `recent` (≤10, 8 weeks). Neither bound proves nothing older
 * exists, so a viewer who may page always gets "Show more" until a click
 * finds history's end. Nothing is fetched before the first click; each click
 * adds up to 20 rows not already shown (`useGuildPastEvents`).
 */
import type { JSX } from 'react';
import type { GuildKind, GuildRecentEventDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Card } from '../hub-bits';
import { QuietEmpty } from '../card-bits';
import { hubCopy } from '../hub-copy';
import { useGuildPastEvents, type GuildPastEvents as PastPaging } from '../api/use-guild-past-events';
import { RecentRow } from './guild-recent-row';

function LoadError({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <div className="flex flex-col items-start gap-3" data-testid="guild-past-events-error">
            <p role="alert" className="w-full rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                Couldn&apos;t load older events. Check your connection and try again.
            </p>
            <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
        </div>
    );
}

function ShowMore({ q }: { q: PastPaging }): JSX.Element | null {
    if (q.isError) return <LoadError onRetry={q.showMore} />;
    if (!q.canShowMore) return q.foundNothing ? <QuietEmpty testId="guild-past-events-end">No older events.</QuietEmpty> : null;
    return (
        <div>
            <Button variant="secondary" size="sm" onClick={q.showMore} disabled={q.isLoading} data-testid="guild-past-events-more">
                {q.isLoading ? 'Loading…' : 'Show more'}
            </Button>
        </div>
    );
}

interface GuildPastEventsProps {
    guildId: number;
    /** The raids payload's `recent` — the first rows, shown before any page loads. */
    recent: readonly GuildRecentEventDto[];
    /** False for a viewer the past route refuses (`canPagePastEvents`): no fetch, no button. */
    canPage: boolean;
    kind: GuildKind | undefined;
}

/** The full-mode Recent list with "Show more" paging. */
export function GuildPastEvents({ guildId, recent, canPage, kind }: GuildPastEventsProps): JSX.Element {
    const copy = hubCopy(kind);
    const q = useGuildPastEvents(guildId, recent);
    const recentIds = new Set(recent.map((e) => e.id));
    const rows = [...recent, ...q.shown.filter((e) => !recentIds.has(e.id))];
    return (
        <div className="flex flex-col gap-3">
            {rows.length === 0
                ? <QuietEmpty>{copy.recentEmpty}</QuietEmpty>
                : <Card className="bg-panel py-1"><ul aria-label={`Recent ${copy.noun} events`}>{rows.map((e) => <RecentRow key={e.id} e={e} />)}</ul></Card>}
            {canPage && <ShowMore q={q} />}
        </div>
    );
}
