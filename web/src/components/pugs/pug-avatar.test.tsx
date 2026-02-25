import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PugAvatar } from './pug-avatar';

describe('PugAvatar', () => {
    describe('Discord CDN avatar', () => {
        it('renders Discord CDN avatar when userId and avatarHash are provided', () => {
            render(
                <PugAvatar
                    username="testplayer"
                    discordUserId="123456789"
                    discordAvatarHash="abc123hash"
                />,
            );

            const img = screen.getByRole('img');
            expect(img).toBeInTheDocument();
            expect(img).toHaveAttribute(
                'src',
                'https://cdn.discordapp.com/avatars/123456789/abc123hash.png?size=64',
            );
            expect(img).toHaveAttribute('alt', 'testplayer');
        });

        it('falls back to initials avatar on image load error', () => {
            render(
                <PugAvatar
                    username="testplayer"
                    discordUserId="123456789"
                    discordAvatarHash="abc123hash"
                />,
            );

            const img = screen.getByRole('img');
            fireEvent.error(img);

            // After error, should show initials fallback
            expect(screen.queryByRole('img')).not.toBeInTheDocument();
            expect(screen.getByText('T')).toBeInTheDocument();
        });
    });

    describe('initials fallback avatar', () => {
        it('renders initials when no Discord avatar is available', () => {
            render(<PugAvatar username="testplayer" />);

            expect(screen.queryByRole('img')).not.toBeInTheDocument();
            expect(screen.getByText('T')).toBeInTheDocument();
        });

        it('renders initials when discordUserId is null', () => {
            render(
                <PugAvatar
                    username="gamerman"
                    discordUserId={null}
                    discordAvatarHash="hash123"
                />,
            );

            expect(screen.queryByRole('img')).not.toBeInTheDocument();
            expect(screen.getByText('G')).toBeInTheDocument();
        });

        it('renders initials when discordAvatarHash is null', () => {
            render(
                <PugAvatar
                    username="gamerman"
                    discordUserId="123456"
                    discordAvatarHash={null}
                />,
            );

            expect(screen.queryByRole('img')).not.toBeInTheDocument();
            expect(screen.getByText('G')).toBeInTheDocument();
        });

        it('shows username as title attribute', () => {
            render(<PugAvatar username="testplayer" />);

            expect(screen.getByTitle('testplayer')).toBeInTheDocument();
        });

        it('generates consistent color for same username', () => {
            const { container: c1 } = render(<PugAvatar username="alice" />);
            const { container: c2 } = render(<PugAvatar username="alice" />);

            const div1 = c1.querySelector('div[style]');
            const div2 = c2.querySelector('div[style]');

            expect(div1?.getAttribute('style')).toBe(div2?.getAttribute('style'));
        });

        it('uppercases the first character as initial', () => {
            render(<PugAvatar username="lowercase" />);
            expect(screen.getByText('L')).toBeInTheDocument();
        });
    });

});
