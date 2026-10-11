import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_BASE_URL } from '../../lib/config';
import { AUTH_METHOD_KEY } from '../../lib/api/auth-storage-keys';
import { getAccessToken } from '../../lib/api/access-token-store';
import { ImpersonationBanner } from './ImpersonationBanner';

function jwtWith(claims: object): string {
    const seg = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(claims)}.sig`;
}

describe('ROK-1754 C: ImpersonationBanner after a reload with a live marker', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
    });

    it('memory is empty, the refresh returns an impersonation token → the banner renders with the cap time', async () => {
        const exp = Math.floor(Date.now() / 1000) + 1800;
        const imp = jwtWith({ sub: 7, username: 'target', role: 'member', impersonatedBy: 1, exp });
        server.use(
            http.post(`${API_BASE_URL}/auth/refresh`, () => HttpResponse.json({ access_token: imp })),
            http.get(`${API_BASE_URL}/auth/me`, () => HttpResponse.json({ id: 7, username: 'target' })),
        );
        expect(getAccessToken()).toBeNull();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><ImpersonationBanner /></QueryClientProvider>);

        expect(await screen.findByText('target')).toBeInTheDocument();
        const endsAt = new Date(exp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const text = screen.getByText(/Viewing as/).textContent;
        expect(text).toContain('applies to all tabs');
        expect(text).toContain(`ends at ${endsAt}`);
        expect(screen.getByRole('button', { name: 'Exit Impersonation' })).toBeInTheDocument();
    });
});
