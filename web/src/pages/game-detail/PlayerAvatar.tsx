import type { JSX } from 'react';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type {
    NowPlayingPlayerDto,
    GameTopPlayerDto,
    PublicNowPlayingPlayerDto,
    PublicGameTopPlayerDto,
} from '@raid-ledger/contract';

/** Player avatar helper for game detail page */
export function PlayerAvatar({ player, size = 'sm' }: {
    /** Anonymous viewers get the public shape: no `discordId`, `avatar` already a URL (ROK-1734). */
    player:
        | NowPlayingPlayerDto
        | GameTopPlayerDto
        | PublicNowPlayingPlayerDto
        | PublicGameTopPlayerDto;
    size?: 'sm' | 'md';
}): JSX.Element {
    const avatarInfo = resolveAvatar(toAvatarUser(player));
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
