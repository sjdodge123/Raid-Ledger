import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvatarWithFallback } from './AvatarWithFallback';

const DEAD_URL = 'https://cdn.discordapp.com/avatars/1/deadhash.png';
const NEW_URL = 'https://cdn.discordapp.com/avatars/1/newhash.png';

describe('AvatarWithFallback (ROK-1714)', () => {
    it('swaps a broken image for the initials fallback on load error', () => {
        render(<AvatarWithFallback avatarUrl={DEAD_URL} username="halfdead" />);

        fireEvent.error(screen.getByRole('img', { name: 'halfdead' }));

        expect(screen.queryByRole('img', { name: 'halfdead' }), 'broken img should be replaced').toBeNull();
        expect(screen.queryByText('H'), 'initials fallback should render after the img error').not.toBeNull();
    });

    it('gives a new avatarUrl a fresh load attempt after an earlier failure', () => {
        const { rerender } = render(<AvatarWithFallback avatarUrl={DEAD_URL} username="halfdead" />);
        fireEvent.error(screen.getByRole('img', { name: 'halfdead' }));

        rerender(<AvatarWithFallback avatarUrl={NEW_URL} username="halfdead" />);

        expect(
            screen.queryByRole('img', { name: 'halfdead' })?.getAttribute('src') ?? 'no <img> rendered',
            'a new URL should render an <img>, not the stale initials fallback',
        ).toBe(NEW_URL);
    });

    it('falls back to initials when a resolved user avatar fails to load', () => {
        render(<AvatarWithFallback user={{ avatar: DEAD_URL }} username="zed" />);

        fireEvent.error(screen.getByRole('img', { name: 'zed' }));

        expect(screen.queryByText('Z'), 'initials fallback should render for a user-resolved avatar').not.toBeNull();
    });

    it('passes through the loading hint and a decorative alt', () => {
        const { container } = render(
            <AvatarWithFallback avatarUrl={DEAD_URL} username="halfdead" loading="lazy" alt="" />,
        );
        const img = container.querySelector('img');

        expect(img?.getAttribute('loading'), 'loading prop should reach the <img>').toBe('lazy');
        expect(img?.getAttribute('alt'), 'alt="" should override the username alt').toBe('');
    });
});
