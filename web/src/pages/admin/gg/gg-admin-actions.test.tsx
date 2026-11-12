/** ROK-2187 — "Send now" asks first: it posts the announcement and DMs players. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { GgAdminActions } from './gg-admin-actions';

const sendGgNow = vi.fn(() => Promise.resolve({}));
vi.mock('../../../lib/api/gg-admin-api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/api/gg-admin-api')>()),
    sendGgNow: () => sendGgNow(),
}));

describe('GgAdminActions — Send now (ROK-2187)', () => {
    it('sends nothing until the admin confirms, then sends once', async () => {
        renderWithProviders(<GgAdminActions year={2026} />);
        fireEvent.click(screen.getByTestId('gg-send-now'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Post the GG 2026 announcement and DM players now\?/)).toBeInTheDocument();
        expect(sendGgNow).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));
        await waitFor(() => expect(sendGgNow).toHaveBeenCalledTimes(1));
    });
});
