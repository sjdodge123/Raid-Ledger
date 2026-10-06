/**
 * ROK-1734: anonymous viewers get the public player shape — no `discordId`,
 * `avatar` already an absolute server-built URL. PlayerAvatar must render it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PublicNowPlayingPlayerDto } from '@raid-ledger/contract';
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
