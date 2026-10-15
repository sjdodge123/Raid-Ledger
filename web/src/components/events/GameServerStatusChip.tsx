/**
 * Live game-server status on the event page (ROK-1776). Core code: it reads the
 * generic `GET /game-servers/status` endpoint and asks the plugin host API whether
 * any provider plugin is active — it never imports a plugin. Renders nothing when
 * no provider is active, the game has no mapped, visible server, or the query errored.
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { StatusChip } from '../ui/status-chip';
import { useGameServerProvidersActive } from '../../plugins/game-server-status';
import { useGameServerStatuses } from '../../hooks/use-game-server-statuses';
import { syncedAgo } from '../../lib/synced-ago';
import { summarizeServerStatuses } from './game-server-status.helpers';

/** How often the chip re-judges staleness on its own, independent of the query. */
export const STATUS_CLOCK_TICK_MS = 30_000;

/**
 * A clock that moves by itself while `running`, so a frozen query — a refetch that
 * hangs, or one react-query paused while offline — still ages a check out to
 * "unknown". Never earlier than the last fetch.
 */
function useStatusClock(fetchedAt: number, running: boolean): number {
    const [tick, setTick] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!running) return;
        const id = setInterval(() => setTick(Date.now()), STATUS_CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, [running]);
    return Math.max(tick, fetchedAt);
}

export function GameServerStatusChip({ gameId }: { gameId: number | undefined }): JSX.Element | null {
    const active = useGameServerProvidersActive();
    const q = useGameServerStatuses(gameId, active);
    const now = useStatusClock(q.dataUpdatedAt, active && (q.data?.length ?? 0) > 0);
    const summary = useMemo(() => summarizeServerStatuses(q.data ?? [], now), [q.data, now]);
    // A failed refetch keeps the last data; showing it would be a frozen "online".
    if (!active || q.isError || !summary) return null;
    return (
        <div className="flex items-center gap-2 mb-4" data-testid="game-server-status">
            <StatusChip tone={summary.tone} title={summary.title}>
                {summary.label}
                {summary.servers > 1 && <span className="sr-only">: {summary.title}</span>}
            </StatusChip>
            <span className="text-xs text-muted">checked {syncedAgo(summary.checkedAt, now)}</span>
        </div>
    );
}
