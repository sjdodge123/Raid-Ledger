import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { GuestProfile } from './user-profile-extra-sections';

vi.mock('../../hooks/use-branding', () => ({
    useBranding: () => ({ brandingQuery: { data: { communityName: 'Test Guild' } } }),
}));

describe('GuestProfile avatar (TDB:1951)', () => {
    it('shows the initials fallback when the Discord avatar image fails to load', () => {
        renderWithProviders(<GuestProfile username="shadowfax" discordId="123" avatarHash="abc" />);

        fireEvent.error(screen.getByRole('img', { name: 'shadowfax' }));

        expect(screen.queryByText('S'), 'initials fallback should render after the img error').not.toBeNull();
        expect(screen.queryByRole('img', { name: 'shadowfax', hidden: true }), 'broken img should be replaced').toBeNull();
    });

    it('gives a new avatar URL a fresh load attempt after an earlier failure', () => {
        const { rerender } = renderWithProviders(<GuestProfile username="shadowfax" discordId="123" avatarHash="abc" />);
        fireEvent.error(screen.getByRole('img', { name: 'shadowfax' }));

        rerender(<GuestProfile username="shadowfax" discordId="123" avatarHash="def" />);

        expect(
            screen.queryByRole('img', { name: 'shadowfax' })?.getAttribute('src') ?? '',
            'the new avatar should render, not the stale initials fallback',
        ).toContain('def');
    });
});

describe('GuestProfile — public roster link without a discordId (ROK-1629)', () => {
    it('renders the server-built avatar URL when discordId is empty', () => {
        const url = 'https://cdn.discordapp.com/avatars/111/abc.png';
        renderWithProviders(<GuestProfile username="shadowfax" discordId="" avatarHash={url} />);
        expect(
            screen.queryByRole('img', { name: 'shadowfax' })?.getAttribute('src') ?? null,
            'the guest avatar must render from the server-built URL with no discordId',
        ).toBe(url);
    });
});
