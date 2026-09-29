/**
 * ROK-1366 follow-up (PR #1384 review): POST /auth/{provider}/link/start sets
 * the httpOnly `rl_link_<provider>` cookie that binds the nonce to this
 * browser; the GET hop is refused without it. The browser only stores a
 * cross-origin Set-Cookie (web :5173 -> API :3000, or any VITE_API_URL host)
 * when the request is sent with `credentials: 'include'`, so the start call
 * states it itself instead of leaning on the shared transport's default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithAuth = vi.fn();
vi.mock('./fetch-api', () => ({ fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args) }));

import { API_BASE_URL } from '../config';
import { startAccountLink } from './link-start-api';

beforeEach(() => {
    fetchWithAuth.mockReset();
    fetchWithAuth.mockResolvedValue({ ok: true, status: 200, json: async () => ({ nonce: 'n0nce', expiresIn: 120 }) });
});

describe('startAccountLink — browser-bound nonce cookie', () => {
    it.each(['discord', 'steam'] as const)(
        '%s: POSTs link/start with credentials: include so the binding cookie is stored',
        async (provider) => {
            await startAccountLink(provider);

            expect(fetchWithAuth).toHaveBeenCalledTimes(1);
            const [endpoint, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit];
            expect(endpoint).toBe(`/auth/${provider}/link/start`);
            expect(init.method).toBe('POST');
            expect(init.credentials).toBe('include');
        },
    );

    it('returns the same-API ?nonce= hop, so the cookie rides the top-level navigation', async () => {
        await expect(startAccountLink('steam', '/profile/integrations')).resolves.toBe(
            `${API_BASE_URL}/auth/steam/link?nonce=n0nce`,
        );
        const init = fetchWithAuth.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(String(init.body))).toEqual({ returnTo: '/profile/integrations' });
        expect(init.credentials).toBe('include');
    });
});
