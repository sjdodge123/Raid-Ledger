/**
 * ROK-1941 D12 — "Scan the last 21 days": starts the hub's backfill and shows
 * the run inline (§4.7 idiom, never a toast). The status query polls only
 * while the run is `running`; a 409 says a scan is already running and the
 * job it carries fills the status line.
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';
import { isConflictError } from '../../../lib/api/api-error';
import { backfillStatusLine } from './hub-media-channel.helpers';
import { useHubMediaBackfill, useStartHubMediaBackfill } from './use-hub-media-channel';

function StartError({ error }: { error: Error | null }): JSX.Element | null {
    if (!error) return null;
    if (isConflictError(error)) {
        return <p role="status" className="text-sm text-warning" data-testid="hub-media-backfill-conflict">A scan is already running.</p>;
    }
    return <p role="alert" className="text-sm text-danger" data-testid="hub-media-backfill-error">{error.message}</p>;
}

/** The scan button plus its inline status; shown only once a channel is bound. */
export function HubMediaBackfillRow({ guildId }: { guildId: number }): JSX.Element {
    const status = useHubMediaBackfill(guildId);
    const start = useStartHubMediaBackfill(guildId);
    const running = status.data?.state === 'running';
    const line = status.data ? backfillStatusLine(status.data) : null;
    return (
        <div className="flex flex-col gap-2">
            <div>
                <Button variant="secondary" size="sm" onClick={() => start.mutate()} loading={start.isPending}
                    disabled={running} data-testid="hub-media-backfill-start">
                    Scan the last 21 days
                </Button>
            </div>
            {line && <p role="status" className="text-sm text-secondary" data-testid="hub-media-backfill-status">{line}</p>}
            <StartError error={start.error} />
        </div>
    );
}
