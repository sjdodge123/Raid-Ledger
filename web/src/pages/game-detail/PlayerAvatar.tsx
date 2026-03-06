import type { JSX } from 'react';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { NowPlayingPlayerDto, GameTopPlayerDto } from '@raid-ledger/contract';

/** Player avatar helper for game detail page */
export function PlayerAvatar({ player, size = 'sm' }: {
    player: NowPlayingPlayerDto | GameTopPlayerDto;
    size?: 'sm' | 'md';
}): JSX.Element {
    const avatarInfo = resolveAvatar(toAvatarUser(player as {
        avatar: string | null; customAvatarUrl: string | null;
        discordId: string | null; username: string;
    }));
    const sizeClass = size === 'md' ? 'w-8 h-8' : 'w-6 h-6';
    if (avatarInfo.url) {
        return (
            <img
                src={avatarInfo.url}
                alt={player.username}
                className={`${sizeClass} rounded-full object-cover`}
            />
        );
    }
    return (
        <div className={`${sizeClass} rounded-full bg-overlay flex items-center justify-center text-xs text-muted`}>
            {player.username.charAt(0).toUpperCase()}
        </div>
    );
}
