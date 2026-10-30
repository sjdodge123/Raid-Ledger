/**
 * ROK-1701 — the claim success state with the REAL `useAuth` (not mocked):
 * `login()` drops the viewer-private caches, mutation cache included, so it
 * must run after the claim mutation settles or the ok state is lost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { ClaimForm } from './claim-form';

const fetchMock = vi.fn();
vi.mock('../../lib/api/native-fetch', () => ({ nativeFetch: (...a: unknown[]) => fetchMock(...a) }));

const GOOD_PW = 'correct horse battery';
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const ADMIN = { id: 1, username: 'admin', role: 'admin', discordId: 'local:admin@local' };

describe('ClaimForm with the real useAuth', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation((url: unknown) => Promise.resolve(
            String(url).endsWith('/setup/claim') ? json(200, { access_token: 'jwt-1' }) : json(200, ADMIN),
        ));
    });

    it('keeps the success state and the Continue link after login() clears caches', async () => {
        const { queryClient } = renderWithProviders(<ClaimForm />);
        const user = userEvent.setup();
        await user.type(screen.getByLabelText('Setup code'), 'MY-SECRET-CODE');
        await user.type(screen.getByLabelText('New password'), GOOD_PW);
        await user.type(screen.getByLabelText('Confirm password'), GOOD_PW);
        await user.click(screen.getByRole('button', { name: 'Claim and set password' }));
        const link = await screen.findByRole('link', { name: 'Continue to setup' });
        expect(link).toHaveAttribute('href', '/admin/setup');
        expect(screen.getByText('Code accepted. This Raid Ledger is yours.')).toBeInTheDocument();
        expect(queryClient.getQueryData(['auth', 'me'])).toMatchObject({ id: 1 });
        expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/me'))).toBe(true);
    });
});
