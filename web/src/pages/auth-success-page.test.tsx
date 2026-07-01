/**
 * ROK-1367: silent-reauth one-shot guard edge case.
 *
 * A silent (prompt=none) Discord re-auth can bounce back as `?error=...`
 * rather than the API's `?silent_failed=1`. The guard was armed before that
 * redirect, so `handleOAuthError` must CLEAR it — otherwise the one-shot stays
 * set for the whole session and blocks every later silent attempt. The
 * existing `?silent_failed=1` branch must still ARM the guard (loop guard).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '../test/render-helpers';
import { AuthSuccessPage } from './auth-success-page';
import { ACCESS_TOKEN_KEY, SILENT_GUARD_KEY } from '../lib/api/auth-storage-keys';

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ login: vi.fn() }) }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../components/auth', () => ({ consumeAuthRedirect: () => null }));

describe('AuthSuccessPage — ROK-1367 silent-guard reset', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('clears the silent guard when Discord returns an OAuth error', async () => {
        // Guard armed by a prior silent attempt.
        sessionStorage.setItem(SILENT_GUARD_KEY, '1');

        renderWithProviders(<AuthSuccessPage />, {
            initialEntries: ['/auth/success?error=access_denied'],
        });

        await waitFor(() =>
            expect(sessionStorage.getItem(SILENT_GUARD_KEY)).toBeNull(),
        );
    });

    it('still arms the guard on the ?silent_failed=1 branch', async () => {
        localStorage.setItem(ACCESS_TOKEN_KEY, 'stale');

        renderWithProviders(<AuthSuccessPage />, {
            initialEntries: ['/auth/success?silent_failed=1'],
        });

        await waitFor(() =>
            expect(sessionStorage.getItem(SILENT_GUARD_KEY)).toBe('1'),
        );
        // The stale access token is dropped on the silent-failure path.
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    });
});
