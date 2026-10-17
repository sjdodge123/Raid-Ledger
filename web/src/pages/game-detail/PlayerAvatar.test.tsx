/**
 * ROK-1734: anonymous viewers get the public player shape — no `discordId`,
 * `avatar` already an absolute server-built URL. PlayerAvatar must render it.
 * ROK-1714: a dead avatar URL falls back to initials.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameTopPlayerDto, PublicNowPlayingPlayerDto } from '@raid-ledger/contract';
import { PlayerAvatar } from './PlayerAvatar';

const URL = 'https://cdn.discordapp.com/avatars/123456789012345678/abcdef.png';

describe('PlayerAvatar (ROK-1734 public shape)', () => {
    it('renders the server-built avatar URL when discordId is absent', () => {
        const player: PublicNowPlayingPlayerDto = {
            userId: 7,
            username: 'anon-visible',
            avatar: URL,
            customAvatarUrl: null,
        };
        render(<PlayerAvatar player={player} />);
        expect(screen.getByRole('img', { name: 'anon-visible' })).toHaveAttribute('src', URL);
    });

    it('falls back to initials when the public avatar is null', () => {
        const player: PublicNowPlayingPlayerDto = {
            userId: 8,
            username: 'nobody',
            avatar: null,
            customAvatarUrl: null,
        };
        render(<PlayerAvatar player={player} />);
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByText('N')).toBeInTheDocument();
    });
});

const stalePlayer: GameTopPlayerDto = {
    userId: 7, username: 'halfdead', avatar: 'deadhash', customAvatarUrl: null, discordId: '111', totalSeconds: 3600,
};

describe('game-detail PlayerAvatar fallback (ROK-1714)', () => {
    it('swaps a stale Discord avatar for initials when the image fails to load', () => {
        render(<PlayerAvatar player={stalePlayer} size="md" />);

        const img = screen.getByRole('img', { name: 'halfdead' });
        expect(img.getAttribute('src')).toBe('https://cdn.discordapp.com/avatars/111/deadhash.png');
        fireEvent.error(img);

        expect(screen.queryByRole('img', { name: 'halfdead' }), 'broken img should be replaced').toBeNull();
        expect(screen.queryByText('H'), 'initials fallback should render after the img error').not.toBeNull();
    });

    it('renders initials directly when the player has no avatar', () => {
        render(<PlayerAvatar player={{ ...stalePlayer, avatar: null }} />);

        expect(screen.queryByRole('img'), 'no <img> without an avatar').toBeNull();
        expect(screen.getByText('H')).toBeTruthy();
    });
});
