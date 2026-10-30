import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { ClaimPage } from './claim-page';

const statusMock = vi.fn();
vi.mock('../../hooks/use-system-status', () => ({ useSystemStatus: () => statusMock() }));
vi.mock('../../hooks/use-auth', () => ({ useAuth: () => ({ login: vi.fn() }) }));

describe('ClaimPage', () => {
    it('shows hours left from claimExpiresAt', () => {
        statusMock.mockReturnValue({ data: { claimRequired: true, claimExpiresAt: new Date(Date.now() + 71.5 * 3_600_000).toISOString() } });
        renderWithProviders(<ClaimPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Claim this Raid Ledger' })).toBeInTheDocument();
        expect(screen.getByTestId('claim-footnote')).toHaveTextContent('(71 hours left)');
    });

    it('omits hours left without an expiry and shows the expired state when lapsed', () => {
        statusMock.mockReturnValue({ data: { claimRequired: true } });
        const { unmount } = renderWithProviders(<ClaimPage />);
        expect(screen.getByTestId('claim-footnote').textContent).not.toContain('hours left');
        unmount();
        statusMock.mockReturnValue({ data: { claimRequired: true, claimExpiresAt: new Date(Date.now() - 1000).toISOString() } });
        renderWithProviders(<ClaimPage />);
        expect(screen.getByTestId('claim-code-message')).toHaveAttribute('data-state', 'expired');
    });

    it('switches host instructions with the segmented radio group', async () => {
        statusMock.mockReturnValue({ data: { claimRequired: true } });
        renderWithProviders(<ClaimPage />);
        expect(screen.getByTestId('claim-host-render')).toHaveTextContent('Environment');
        await userEvent.setup().click(screen.getByRole('radio', { name: 'In the logs' }));
        expect(screen.getByTestId('claim-host-logs')).toHaveTextContent('Setup code: XXXX-XXXX-XXXX-XXXX (open /claim)');
    });
});
