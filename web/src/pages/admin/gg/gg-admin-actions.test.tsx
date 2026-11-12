/** ROK-2187 — "Send now" asks first, posts the announcement only, and toasts what actually happened. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { GgAdminActions } from './gg-admin-actions';

const sendGgNow = vi.fn((): Promise<unknown> => Promise.resolve({ status: 'announced', year: 2026, announcedAt: new Date().toISOString() }));
vi.mock('../../../lib/api/gg-admin-api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/api/gg-admin-api')>()),
    sendGgNow: () => sendGgNow(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../../../lib/toast', () => ({ toast }));

async function confirmSend(): Promise<HTMLElement> {
    fireEvent.click(screen.getByTestId('gg-send-now'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));
    return dialog;
}

describe('GgAdminActions — Send now (ROK-2187)', () => {
    beforeEach(() => { sendGgNow.mockClear(); toast.success.mockClear(); toast.error.mockClear(); });

    it('sends nothing until the admin confirms, then sends once', async () => {
        renderWithProviders(<GgAdminActions year={2026} />);
        fireEvent.click(screen.getByTestId('gg-send-now'));
        const dialog = await screen.findByRole('dialog');
        expect(sendGgNow).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));
        await waitFor(() => expect(sendGgNow).toHaveBeenCalledTimes(1));
    });

    it('says the post is the announcement only — DMs follow on the 5-minute schedule', async () => {
        renderWithProviders(<GgAdminActions year={2026} />);
        fireEvent.click(screen.getByTestId('gg-send-now'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Post the GG 2026 announcement now\?/)).toBeInTheDocument();
        expect(within(dialog).getByText(/every 5 minutes/)).toBeInTheDocument();
        expect(within(dialog).queryByText(/and DM/)).not.toBeInTheDocument();
    });

    it('toasts success when the announcement went out', async () => {
        renderWithProviders(<GgAdminActions year={2026} />);
        await confirmSend();
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/GG 2026 announced/)));
        expect(toast.success).not.toHaveBeenCalledWith('Done');
    });

    it('toasts an error naming the reason when delivery is disabled', async () => {
        sendGgNow.mockResolvedValueOnce({ status: 'disabled' });
        renderWithProviders(<GgAdminActions year={2026} />);
        await confirmSend();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/turned off/)));
        expect(toast.success).not.toHaveBeenCalled();
    });
});
