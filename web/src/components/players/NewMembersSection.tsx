import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useRecentPlayers } from '../../hooks/use-players';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

/**
 * Horizontal scrollable row of recently joined players (ROK-298).
 * Shows up to 10 players who joined in the last 30 days.
 * Hidden when there are no recent members.
 */
export function NewMembersSection() {
    const { data, isLoading } = useRecentPlayers();
    const players = data?.data ?? [];

    if (isLoading) {
        return (
            <div>
                <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
                    New Members
                </h2>
                <div
                    className="flex gap-3 overflow-x-auto pb-2"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div
                            key={i}
                            className="flex-shrink-0 w-20 flex flex-col items-center animate-pulse"
                        >
                            <div className="w-12 h-12 rounded-full bg-overlay" />
                            <div className="h-3 w-14 bg-overlay rounded mt-2" />
                            <div className="h-2.5 w-10 bg-overlay rounded mt-1" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (players.length === 0) {
        return null;
    }

    return (
        <div>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
                New Members
            </h2>
            <div
                className="flex gap-3 overflow-x-auto pb-2"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {players.map((player) => {
                    const avatar = resolveAvatar(toAvatarUser(player));
                    const joinedAgo = formatDistanceToNow(new Date(player.createdAt), {
                        addSuffix: false,
                    });

                    return (
                        <Link
                            key={player.id}
                            to={`/users/${player.id}`}
                            className="flex-shrink-0 w-20 flex flex-col items-center group transition-transform hover:scale-105"
                        >
                            {avatar.url ? (
                                <img
                                    src={avatar.url}
                                    alt={player.username}
                                    className="w-12 h-12 rounded-full bg-overlay object-cover ring-2 ring-emerald-500/30 group-hover:ring-emerald-500/60 transition-all group-hover:shadow-lg group-hover:shadow-emerald-500/10"
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                    }}
                                />
                            ) : null}
                            <div
                                className={`w-12 h-12 rounded-full bg-overlay flex items-center justify-center text-lg text-muted ring-2 ring-emerald-500/30 group-hover:ring-emerald-500/60 transition-all group-hover:shadow-lg group-hover:shadow-emerald-500/10 ${avatar.url ? 'hidden' : ''}`}
                            >
                                {player.username.charAt(0).toUpperCase()}
                            </div>
                            <span className="mt-2 text-sm font-medium text-foreground truncate max-w-full group-hover:text-emerald-400 transition-colors">
                                {player.username}
                            </span>
                            <span className="text-xs text-muted">
                                {joinedAgo} ago
                            </span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
