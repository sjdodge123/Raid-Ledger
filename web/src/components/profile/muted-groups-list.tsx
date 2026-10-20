/**
 * The viewer's muted groups (ROK-1832), shown under the "Group posts" row on
 * `/profile/notifications` — a mirror of the muted-games list (ROK-1797).
 * Each group links to its hub and can be unmuted here through the write-only
 * mutation hook, which also invalidates this list.
 */
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { HubNotificationMuteItemDto, HubNotificationMuteListDto } from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api/fetch-api';
import { getAuthToken, useViewerCacheScope } from '../../hooks/use-auth';
import { hubMutesQueryKey } from '../../hooks/game-interest-query-key';
import { useHubNotificationMuteMutation } from '../../hooks/use-hub-notification-mute';
import { Button } from '../ui/button';

function MutedGroupRow({ group }: { group: HubNotificationMuteItemDto }): JSX.Element {
    const unmute = useHubNotificationMuteMutation(group.guildId);
    return (
        <li className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-baseline gap-2">
                <Link to={`/guilds/${group.guildId}`} className="text-sm text-foreground hover:underline truncate min-w-0">
                    {group.name}
                </Link>
                {group.gameName && <span className="text-xs text-muted truncate">{group.gameName}</span>}
            </div>
            <Button variant="ghost" size="sm" loading={unmute.isPending} aria-label={`Unmute ${group.name}`}
                onClick={() => unmute.mutate(false)}>
                Unmute
            </Button>
        </li>
    );
}

/** Muted-groups list with per-row Unmute; renders nothing until loaded. */
export function MutedGroupsList(): JSX.Element | null {
    const viewer = useViewerCacheScope();
    const { data } = useQuery<HubNotificationMuteListDto>({
        queryKey: hubMutesQueryKey(viewer),
        queryFn: () => fetchApi<HubNotificationMuteListDto>('/notifications/hub-mutes'),
        enabled: !!getAuthToken(),
    });
    if (!data) return null;
    return (
        <div data-testid="muted-groups-list" className="pb-3 pl-2">
            <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Muted groups</div>
            {data.data.length === 0 ? (
                <p className="text-xs text-muted">No muted groups. Use the bell on a group&apos;s page to mute one.</p>
            ) : (
                <ul className="space-y-1">
                    {data.data.map((group) => <MutedGroupRow key={group.guildId} group={group} />)}
                </ul>
            )}
        </div>
    );
}
