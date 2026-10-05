import type { JSX } from 'react';
import { toAvatarUser } from '../../lib/avatar';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import type {
    NowPlayingPlayerDto,
    GameTopPlayerDto,
    PublicNowPlayingPlayerDto,
    PublicGameTopPlayerDto,
} from '@raid-ledger/contract';

/** Player avatar helper for game detail page (ROK-1714: falls back to initials on a dead URL) */
export function PlayerAvatar({ player, size = 'sm' }: {
    /** Anonymous viewers get the public shape: no `discordId`, `avatar` already a URL (ROK-1734). */
    player:
        | NowPlayingPlayerDto
        | GameTopPlayerDto
        | PublicNowPlayingPlayerDto
        | PublicGameTopPlayerDto;
    size?: 'sm' | 'md';
}): JSX.Element {
    const user = toAvatarUser(player);
    const sizeClass = size === 'md' ? 'w-8 h-8' : 'w-6 h-6';
    return <AvatarWithFallback user={user} username={player.username} sizeClassName={sizeClass} />;
}
