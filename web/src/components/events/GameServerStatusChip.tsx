/**
 * Live game-server status on the event page (ROK-1776). Core code: it reads the
 * generic `GET /game-servers/status` endpoint and asks the plugin host API whether
 * any provider plugin is active — it never imports a plugin. Renders nothing when
 * no provider is active or the game has no mapped, visible server.
 */
import { useMemo, type JSX } from 'react';
import { StatusChip } from '../ui/status-chip';
import { useGameServerProvidersActive } from '../../plugins/game-server-status';
import { useGameServerStatuses } from '../../hooks/use-game-server-statuses';
import { syncedAgo } from '../../lib/synced-ago';
import { summarizeServerStatuses } from './game-server-status.helpers';

export function GameServerStatusChip({ gameId }: { gameId: number | undefined }): JSX.Element | null {
    const active = useGameServerProvidersActive();
    const q = useGameServerStatuses(gameId, active);
    // "Now" is the fetch time: the query refetches every minute, and render stays pure.
    const now = q.dataUpdatedAt;
    const summary = useMemo(() => summarizeServerStatuses(q.data ?? [], now), [q.data, now]);
    if (!active || !summary) return null;
    return (
        <div className="flex items-center gap-2 mb-4" data-testid="game-server-status">
            <StatusChip tone={summary.tone} title={summary.title}>{summary.label}</StatusChip>
            <span className="text-xs text-muted">checked {syncedAgo(summary.checkedAt, now)}</span>
        </div>
    );
}
