/**
 * ROK-1367: silent-reauth one-shot guard edge case → timestamped cooldown.
 *
 * A silent (prompt=none) Discord re-auth can bounce back as `?error=...`
 * rather than the API's `?silent_failed=1`. `handleOAuthError` must NOT clear
 * the guard (clearing lets the next mount fire another silent attempt → an
 * infinite `/` ↔ Discord loop); the timestamped cooldown in silent-reauth.ts
 * governs re-enablement instead. The `?silent_failed=1` branch must still ARM
 * the guard (with a timestamp).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderWithProviders } from '../test/render-helpers';
import { AuthSuccessPage } from './auth-success-page';
import { toast } from '../lib/toast';
import { ACCESS_TOKEN_KEY, SILENT_GUARD_KEY } from '../lib/api/auth-storage-keys';

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ login: vi.fn() }) }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../components/auth', () => ({ consumeAuthRedirect: () => null }));

describe('AuthSuccessPage — ROK-1367 silent-guard cooldown', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.clearAllMocks();
    });

    it('does NOT clear the silent guard when Discord returns an OAuth error', async () => {
        // Guard armed (timestamped) by a prior silent attempt.
        const armed = String(Date.now());
        sessionStorage.setItem(SILENT_GUARD_KEY, armed);

        renderWithProviders(<AuthSuccessPage />, {
            initialEntries: ['/auth/success?error=access_denied'],
        });

        // The error path ran (toast fired) …
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        // … and left the guard intact so the cooldown governs retries.
        expect(sessionStorage.getItem(SILENT_GUARD_KEY)).toBe(armed);
    });

    it('arms a fresh timestamp guard on the ?silent_failed=1 branch', async () => {
        localStorage.setItem(ACCESS_TOKEN_KEY, 'stale');
        const before = Date.now();

        renderWithProviders(<AuthSuccessPage />, {
            initialEntries: ['/auth/success?silent_failed=1'],
        });

        await waitFor(() =>
            expect(sessionStorage.getItem(SILENT_GUARD_KEY)).not.toBeNull(),
        );
        expect(
            Number(sessionStorage.getItem(SILENT_GUARD_KEY)),
        ).toBeGreaterThanOrEqual(before);
        // The stale access token is dropped on the silent-failure path.
        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    });
});
