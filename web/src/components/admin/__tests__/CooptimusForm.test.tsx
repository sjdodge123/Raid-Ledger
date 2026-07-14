/**
 * CooptimusForm tests (ROK-1397): save round-trip, honest test-connection
 * failure banner, clear, and the empty-input guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/render-helpers';
import { CooptimusForm } from '../CooptimusForm';

const updateAsync = vi.fn();
const testAsync = vi.fn();
const clearAsync = vi.fn();
let configured = false;
vi.mock('../../../hooks/admin/use-cooptimus-settings', () => ({
    useCooptimusSettings: () => ({
        cooptimusStatus: { data: { configured }, isLoading: false },
        updateCooptimus: { mutateAsync: updateAsync, isPending: false },
        testCooptimus: { mutateAsync: testAsync, isPending: false },
        clearCooptimus: { mutateAsync: clearAsync, isPending: false },
    }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../../../lib/toast', () => ({
    toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

describe('CooptimusForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configured = false;
    });

    it('saves a trimmed user-agent and clears the input', async () => {
        updateAsync.mockResolvedValue({ success: true, message: 'saved' });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        await user.type(screen.getByLabelText(/allowlisted user-agent/i), '  RaidLedger/1.0  ');
        await user.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() =>
            expect(updateAsync).toHaveBeenCalledWith({ userAgent: 'RaidLedger/1.0' }),
        );
        expect(toastSuccess).toHaveBeenCalledWith('saved');
        expect(screen.getByLabelText(/allowlisted user-agent/i)).toHaveValue('');
    });

    it('blocks empty submits client-side', async () => {
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        await user.click(screen.getByRole('button', { name: /^Save$/i }));

        expect(updateAsync).not.toHaveBeenCalled();
        expect(toastError).toHaveBeenCalledWith('User-agent is required');
    });

    it('hides Test/Clear until configured; shows the honest 403 banner on test failure', async () => {
        expect(renderWithProviders(<CooptimusForm />).container).toBeTruthy();
        expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument();

        configured = true;
        testAsync.mockResolvedValue({
            success: false,
            message: 'HTTP 403 — the user-agent is not allowlisted past the Cloudflare challenge',
        });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);
        await user.click(screen.getAllByRole('button', { name: /test connection/i })[0]);

        await waitFor(() => expect(screen.getByText(/HTTP 403/)).toBeInTheDocument());
        expect(toastError).toHaveBeenCalled();
    });

    it('clear calls the mutation and toasts', async () => {
        configured = true;
        clearAsync.mockResolvedValue({ success: true, message: 'cleared' });
        const user = userEvent.setup();
        renderWithProviders(<CooptimusForm />);

        await user.click(screen.getByRole('button', { name: /^Clear$/i }));

        await waitFor(() => expect(clearAsync).toHaveBeenCalled());
        expect(toastSuccess).toHaveBeenCalledWith('cleared');
    });
});
