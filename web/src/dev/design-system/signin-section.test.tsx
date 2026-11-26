/** ROK-2370: /dev/design-system shows the Last used card per method and the code panel states. */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { SigninSection } from './signin-section';

describe('SigninSection (design-system samples)', () => {
    it('renders a Last used card for every method and the waiting, expired and signed-in panel states', () => {
        renderWithProviders(<SigninSection />);
        const root = screen.getByTestId('ds-signin');

        expect(within(root).getAllByTestId('last-used-signin')).toHaveLength(3);
        expect(within(root).getByRole('button', { name: 'Continue as Thornwick with Discord app code' })).toBeInTheDocument();
        expect(within(root).getByTestId('signin-code-value')).toHaveTextContent('K7QD-2M9X');
        expect(within(root).getByText('This code expired.')).toBeInTheDocument();
        expect(within(root).getByText(/Signed in as Thornwick/)).toBeInTheDocument();
    });
});
