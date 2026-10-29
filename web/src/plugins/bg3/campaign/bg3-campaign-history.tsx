/**
 * ROK-1958 D-9 / §4.3 (3) — the Campaign tab's History: every session of the
 * active campaign on the same token rail as the Session history card, newest
 * first, 20 per page with "Show more" (`nextCursor`). The card's "Show all"
 * lands here (`#campaign`).
 */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';
import { useBg3SessionPages } from '../hooks/use-bg3-hub';
import { Bg3SessionRow } from '../hub/bg3-session-row';
import { Bg3WidgetError } from '../hub/bg3-widget-error';

export function Bg3CampaignHistory({ hubId, campaignId }: { hubId: number; campaignId: number }): JSX.Element {
    const pages = useBg3SessionPages(hubId, campaignId);
    if (pages.isError && !pages.data) {
        return <Bg3WidgetError text="Couldn't load the sessions." onRetry={() => { void pages.refetch(); }} />;
    }
    if (!pages.data) return <div className="h-11 animate-pulse rounded-md bg-panel" data-testid="bg3-history-loading" />;
    const sessions = pages.data.pages.flatMap((p) => p.sessions);
    if (sessions.length === 0) return <p className="text-sm text-muted">No sessions yet.</p>;
    return (
        <div className="flex flex-col gap-3">
            <ol className="ml-1.5 border-l-2 border-edge pl-4" aria-label="All sessions" data-testid="bg3-history">
                {sessions.map((s, i) => <Bg3SessionRow key={`${s.lastSaveId}-${s.startedAt}`} session={s} latest={i === 0} />)}
            </ol>
            {pages.hasNextPage && (
                <div>
                    <Button variant="secondary" size="sm" onClick={() => { void pages.fetchNextPage(); }}
                        disabled={pages.isFetchingNextPage}>
                        {pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
                    </Button>
                </div>
            )}
        </div>
    );
}
