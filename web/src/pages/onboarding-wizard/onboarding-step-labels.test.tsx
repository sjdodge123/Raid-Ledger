import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectStepLabel } from './onboarding-step-labels';

const user = { avatar: 'deadhash', displayName: null, username: 'halfdead', discordId: '111' };

describe('ConnectStepLabel avatar (ROK-1714)', () => {
    it('builds the Discord CDN URL from the avatar hash', () => {
        render(<ConnectStepLabel user={user} isCurrent={false} isVisited={false} />);

        expect(screen.getByRole('img', { name: 'halfdead' }).getAttribute('src'), 'hash must not be used as a relative src')
            .toBe('https://cdn.discordapp.com/avatars/111/deadhash.png');
    });

    it('swaps a broken avatar image for the initial', () => {
        render(<ConnectStepLabel user={user} isCurrent={false} isVisited={false} />);

        fireEvent.error(screen.getByRole('img', { name: 'halfdead' }));

        expect(screen.queryByRole('img', { name: 'halfdead' }), 'broken img should be replaced').toBeNull();
        expect(screen.queryByText('H'), 'initial fallback should render after the img error').not.toBeNull();
    });
});
