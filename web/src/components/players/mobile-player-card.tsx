import type { UserPreviewDto } from '@raid-ledger/contract';
import { Link } from 'react-router-dom';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface MobilePlayerCardProps {
    player: UserPreviewDto;
}

/**
 * Mobile-optimized player card — vertical layout with 64px avatar.
 * Renders below md breakpoint in a 2-column grid.
 */
export function MobilePlayerCard({ player }: MobilePlayerCardProps) {
    const avatar = resolveAvatar(toAvatarUser(player));

    return (
        <Link
            to={`/users/${player.id}`}
            data-testid="mobile-player-card"
            className="flex flex-col items-center gap-2 p-4 bg-surface rounded-lg border border-edge hover:bg-overlay hover:border-dim transition-colors text-center group"
        >
            {/* 64px avatar */}
            {avatar.url ? (
                <img
                    src={avatar.url}
                    alt={player.username}
                    className="w-16 h-16 rounded-full bg-overlay object-cover"
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                />
            ) : null}
            <div
                className={`w-16 h-16 rounded-full bg-overlay flex items-center justify-center text-2xl text-muted ${avatar.url ? 'hidden' : ''}`}
            >
                {player.username.charAt(0).toUpperCase()}
            </div>

            {/* Username */}
            <div className="min-w-0 w-full">
                <h3 className="font-medium text-sm text-foreground group-hover:text-emerald-400 transition-colors truncate">
                    {player.username}
                </h3>
            </div>
        </Link>
    );
}
