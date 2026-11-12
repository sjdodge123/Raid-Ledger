/**
 * ROK-2185 item 3 (operator ruling Q4 = A) — the Events tab's Recent list,
 * paging back through the hub's full history. The first rows are the raids
 * payload's `recent` (≤10, 8 weeks); the newest past-events page is fetched
 * alongside so "Show more" appears only when there is something older. Each
 * click reveals one more page (20); the button goes once `nextCursor` is null
 * and every fetched row is shown. Rows are de-duplicated by event id, so the
 * newest page repeating `recent` adds only what is new.
 */
import { useState, type JSX } from 'react';
import type { GuildKind, GuildPastEventsPageDto, GuildRecentEventDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Card } from '../hub-bits';
import { QuietEmpty } from '../card-bits';
import { hubCopy } from '../hub-copy';
import { useGuildPastEvents, type GuildPastEventsQuery } from '../api/use-guild-past-events';
import { RecentRow } from './guild-recent-row';

interface PastRows { rows: GuildRecentEventDto[]; hasHidden: boolean }

/** `recent` plus the first `revealed` pages, de-duplicated; `hasHidden` = a fetched page still holds a new row. */
function pastEventRows(recent: readonly GuildRecentEventDto[], pages: readonly GuildPastEventsPageDto[], revealed: number): PastRows {
    const rows = [...recent];
    const seen = new Set(rows.map((e) => e.id));
    for (const e of pages.slice(0, revealed).flatMap((p) => p.events)) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        rows.push(e);
    }
    const hasHidden = pages.slice(revealed).some((p) => p.events.some((e) => !seen.has(e.id)));
    return { rows, hasHidden };
}

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

function retry(q: GuildPastEventsQuery): void {
    if (q.data) void q.fetchNextPage();
    else void q.refetch();
}

interface ShowMoreProps { q: GuildPastEventsQuery; hasHidden: boolean; onMore: () => void }

function ShowMore({ q, hasHidden, onMore }: ShowMoreProps): JSX.Element | null {
    if (q.isError) return <LoadError onRetry={() => retry(q)} />;
    if (!hasHidden && !q.hasNextPage) return null;
    return (
        <div>
            <Button variant="secondary" size="sm" onClick={onMore} disabled={q.isFetchingNextPage} data-testid="guild-past-events-more">
                {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
        </div>
    );
}

interface GuildPastEventsProps {
    guildId: number;
    /** The raids payload's `recent` — the first rows, shown before any page loads. */
    recent: readonly GuildRecentEventDto[];
    /** False for a viewer the past route refuses (a visitor): no fetch, no button. */
    canPage: boolean;
    kind: GuildKind | undefined;
}

/** The full-mode Recent list with "Show more" paging. */
export function GuildPastEvents({ guildId, recent, canPage, kind }: GuildPastEventsProps): JSX.Element {
    const copy = hubCopy(kind);
    const q = useGuildPastEvents(guildId, canPage);
    const [revealed, setRevealed] = useState(0);
    const pages = q.data?.pages ?? [];
    const { rows, hasHidden } = pastEventRows(recent, pages, revealed);
    const onMore = (): void => {
        const next = revealed + 1;
        setRevealed(next);
        if (next > pages.length && q.hasNextPage) void q.fetchNextPage();
    };
    return (
        <div className="flex flex-col gap-3">
            {rows.length === 0
                ? <QuietEmpty>{copy.recentEmpty}</QuietEmpty>
                : <Card className="bg-panel py-1"><ul aria-label={`Recent ${copy.noun} events`}>{rows.map((e) => <RecentRow key={e.id} e={e} />)}</ul></Card>}
            {canPage && <ShowMore q={q} hasHidden={hasHidden} onMore={onMore} />}
        </div>
    );
}
