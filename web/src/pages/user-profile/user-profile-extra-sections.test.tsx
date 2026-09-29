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
});
