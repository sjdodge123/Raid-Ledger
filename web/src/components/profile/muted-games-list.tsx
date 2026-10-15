/**
 * The viewer's muted games (ROK-1797), shown under the "Subscribed Games"
 * row on `/profile/notifications`. Each game links to its page and can be
 * unmuted here; the write-only mutation hook keeps this list from fetching
 * every game's interest just to offer an Unmute button.
 */
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { GameNotificationMuteItemDto, GameNotificationMuteListDto } from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api/fetch-api';
import { getAuthToken, useViewerCacheScope } from '../../hooks/use-auth';
import { gameMutesQueryKey } from '../../hooks/game-interest-query-key';
import { useGameNotificationMuteMutation } from '../../hooks/use-game-notification-mute';
import { Button } from '../ui/button';

function MutedGameRow({ game }: { game: GameNotificationMuteItemDto }): JSX.Element {
    const unmute = useGameNotificationMuteMutation(game.gameId);
    return (
        <li className="flex items-center justify-between gap-3">
            <Link to={`/games/${game.gameId}`} className="text-sm text-foreground hover:underline truncate min-w-0">
                {game.name}
            </Link>
            <Button variant="ghost" size="sm" loading={unmute.isPending} aria-label={`Unmute ${game.name}`}
                onClick={() => unmute.mutate(false)}>
                Unmute
            </Button>
        </li>
    );
}

export function MutedGamesList(): JSX.Element | null {
    const viewer = useViewerCacheScope();
    const { data } = useQuery<GameNotificationMuteListDto>({
        queryKey: gameMutesQueryKey(viewer),
        queryFn: () => fetchApi<GameNotificationMuteListDto>('/notifications/game-mutes'),
        enabled: !!getAuthToken(),
    });
    if (!data) return null;
    return (
        <div data-testid="muted-games-list" className="pb-3 pl-2">
            <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Muted games</div>
            {data.data.length === 0 ? (
                <p className="text-xs text-muted">No muted games. Use the bell on a game&apos;s page to mute one.</p>
            ) : (
                <ul className="space-y-1">
                    {data.data.map((game) => <MutedGameRow key={game.gameId} game={game} />)}
                </ul>
            )}
        </div>
    );
}
