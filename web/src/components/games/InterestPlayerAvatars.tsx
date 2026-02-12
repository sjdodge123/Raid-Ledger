import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { InterestPlayerPreviewDto } from '@raid-ledger/contract';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface InterestPlayerAvatarsProps {
    /** Array of interested players from the API */
    players: InterestPlayerPreviewDto[];
    /** Total count of interested players */
    totalCount: number;
    /** Maximum avatars to show before overflow (default 6) */
    maxVisible?: number;
    /** Game ID for the "+N more" overflow link to the filtered players page */
    gameId?: number;
}

/**
 * ROK-282: Displays clickable player avatars next to the game interest button.
 * Each avatar links to the player's profile page. Overflow shows "+N more".
 * Reuses the same avatar resolution and stacking pattern as AttendeeAvatars.
 */
export function InterestPlayerAvatars({
    players,
    totalCount,
    maxVisible = 6,
    gameId,
}: InterestPlayerAvatarsProps) {
    const visiblePlayers = useMemo(
        () => players.slice(0, maxVisible),
        [players, maxVisible],
    );
    const overflowCount = totalCount - visiblePlayers.length;

    if (visiblePlayers.length === 0) {
        return (
            <span className="text-sm text-muted">
                {totalCount} player{totalCount !== 1 ? 's' : ''} interested
            </span>
        );
    }

    return (
        <div className="flex items-center gap-2">
            {/* Avatar stack */}
            <div className="flex items-center">
                {visiblePlayers.map((player, index) => {
                    const resolved = resolveAvatar(toAvatarUser(player));
                    const avatarUrl = resolved.url;

                    return (
                        <Link
                            key={player.id}
                            to={`/users/${player.id}`}
                            className="block rounded-full ring-2 ring-surface hover:ring-emerald-500/50 transition-all hover:z-10 hover:scale-110 flex-shrink-0"
                            style={{
                                marginLeft: index > 0 ? '-8px' : 0,
                                zIndex: visiblePlayers.length - index,
                                position: 'relative',
                            }}
                            title={player.username}
                        >
                            {avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt={player.username}
                                    className="w-8 h-8 rounded-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-foreground ${getInitialsBg(player.username)}`}
                                >
                                    {player.username.charAt(0).toUpperCase()}
                                </div>
                            )}
                        </Link>
                    );
                })}
            </div>

            {/* Count / overflow text */}
            {overflowCount > 0 && gameId ? (
                <Link
                    to={`/players?gameId=${gameId}`}
                    className="text-sm text-emerald-400 hover:text-emerald-300 whitespace-nowrap transition-colors"
                >
                    +{overflowCount} more
                </Link>
            ) : (
                <span className="text-sm text-muted whitespace-nowrap">
                    {overflowCount > 0
                        ? `+${overflowCount} more`
                        : `${totalCount} player${totalCount !== 1 ? 's' : ''} interested`}
                </span>
            )}
        </div>
    );
}

/** Generate a consistent background color from username */
function getInitialsBg(username: string): string {
    const colors = [
        'bg-red-500',
        'bg-orange-500',
        'bg-amber-500',
        'bg-yellow-500',
        'bg-lime-500',
        'bg-green-500',
        'bg-emerald-500',
        'bg-teal-500',
        'bg-cyan-500',
        'bg-sky-500',
        'bg-blue-500',
        'bg-indigo-500',
        'bg-violet-500',
        'bg-purple-500',
        'bg-fuchsia-500',
        'bg-pink-500',
    ];
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
}
