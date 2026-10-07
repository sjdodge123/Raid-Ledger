import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { InterestPlayerPreviewDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { InterestPlayerAvatars } from './InterestPlayerAvatars';

const stalePlayer: InterestPlayerPreviewDto = {
    id: 7, username: 'halfdead', avatar: 'deadhash', customAvatarUrl: null, discordId: '111',
};

describe('InterestPlayerAvatars avatar fallback (ROK-1714)', () => {
    it('renders the Discord CDN avatar for a player with a hash', () => {
        renderWithProviders(<InterestPlayerAvatars players={[stalePlayer]} totalCount={1} />);

        expect(screen.getByRole('img', { name: 'halfdead' }).getAttribute('src')).toBe(
            'https://cdn.discordapp.com/avatars/111/deadhash.png',
        );
    });

    it('swaps a stale Discord avatar for initials when the image fails to load', () => {
        renderWithProviders(<InterestPlayerAvatars players={[stalePlayer]} totalCount={1} />);

        fireEvent.error(screen.getByRole('img', { name: 'halfdead' }));

        expect(screen.queryByRole('img', { name: 'halfdead' }), 'broken img should be replaced').toBeNull();
        expect(screen.queryByText('H'), 'initials fallback should render after the img error').not.toBeNull();
    });

    it('keeps the profile link around the fallback', () => {
        renderWithProviders(<InterestPlayerAvatars players={[stalePlayer]} totalCount={1} />);
        fireEvent.error(screen.getByRole('img', { name: 'halfdead' }));

        expect(screen.getByTitle('halfdead').getAttribute('href'), 'fallback should stay linked to the profile').toBe('/users/7');
    });
});
