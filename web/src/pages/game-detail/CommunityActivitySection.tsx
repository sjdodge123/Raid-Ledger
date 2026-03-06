import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameActivity, useGameNowPlaying } from '../../hooks/use-games-discover';
import { formatPlaytime, PERIOD_LABELS } from '../../lib/activity-utils';
import type { ActivityPeriod } from '@raid-ledger/contract';
import { PlayerAvatar } from './PlayerAvatar';

/** ROK-443: Community activity section for game detail page */
// eslint-disable-next-line max-lines-per-function
export function CommunityActivitySection({ gameId }: { gameId: number }): JSX.Element | null {
    const [period, setPeriod] = useState<ActivityPeriod>('week');
    const { data: activityData, isLoading: activityLoading } = useGameActivity(gameId, period);
    const { data: nowPlayingData } = useGameNowPlaying(gameId);

    const topPlayers = activityData?.topPlayers ?? [];
    const totalSeconds = activityData?.totalSeconds ?? 0;
    const nowPlaying = nowPlayingData?.players ?? [];
    const nowPlayingCount = nowPlayingData?.count ?? 0;
    const hasAnyData = topPlayers.length > 0 || nowPlayingCount > 0;

    if (!hasAnyData && !activityLoading) return null;

    return (
        <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-foreground">Community Activity</h2>
                <div className="flex gap-1">
                    {PERIOD_LABELS.map((p) => (
                        <button key={p.value} onClick={() => setPeriod(p.value)}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                                period === p.value ? 'bg-emerald-600 text-white' : 'bg-overlay text-muted hover:text-foreground'
                            }`}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            <NowPlayingRow players={nowPlaying} count={nowPlayingCount} />

            {totalSeconds > 0 && (
                <div className="text-sm text-muted mb-3">
                    {formatPlaytime(totalSeconds)} total community playtime
                </div>
            )}

            <TopPlayersList players={topPlayers} isLoading={activityLoading} />
        </section>
    );
}

/** Now playing row with player avatars */
function NowPlayingRow({ players, count }: {
    players: { userId: number; username: string; avatar: string | null; customAvatarUrl: string | null; discordId: string | null }[];
    count: number;
}): JSX.Element | null {
    if (count <= 0) return null;
    return (
        <div className="bg-panel border border-edge rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                    {players.slice(0, 6).map((player) => (
                        <Link key={player.userId} to={`/users/${player.userId}`}>
                            <PlayerAvatar player={player} size="md" />
                        </Link>
                    ))}
                </div>
                <span className="text-sm text-emerald-400 font-medium">{count} playing now</span>
            </div>
        </div>
    );
}

/** Top players leaderboard list */
// eslint-disable-next-line max-lines-per-function
function TopPlayersList({ players, isLoading }: {
    players: { userId: number; username: string; totalSeconds: number; avatar: string | null; customAvatarUrl: string | null; discordId: string | null }[];
    isLoading: boolean;
}): JSX.Element | null {
    if (isLoading) {
        return (
            <div className="space-y-2">
                {[1, 2, 3].map((i) => (<div key={i} className="h-12 bg-overlay rounded-lg animate-pulse" />))}
            </div>
        );
    }
    if (players.length === 0) return null;
    return (
        <div className="space-y-2">
            {players.map((player, idx) => (
                <Link key={player.userId} to={`/users/${player.userId}`}
                    className="flex items-center gap-3 bg-panel border border-edge rounded-lg p-3 hover:opacity-80 transition-opacity">
                    <span className="text-xs text-muted w-5 text-right">#{idx + 1}</span>
                    <PlayerAvatar player={player} size="md" />
                    <span className="font-medium text-foreground flex-1 truncate">{player.username}</span>
                    <span className="text-sm text-muted">{formatPlaytime(player.totalSeconds)}</span>
                </Link>
            ))}
        </div>
    );
}
