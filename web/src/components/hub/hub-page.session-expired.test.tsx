/**
 * ROK-1947: a hub GET whose 401 survives the transparent refresh (no session
 * marker, or an indeterminate refresh — a phone tab resumed with an expired
 * in-memory token) must offer a sign-in, not the generic "couldn't load" box,
 * while the cached `/auth/me` user keeps the AuthGuard open.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { AUTH_METHOD_KEY } from '../../lib/api/auth-storage-keys';
import { GuildPage } from './hub-page';

const API = 'http://localhost:3000';
const COPY = 'Your session expired. Sign in again to see this hub.';
let refreshCalls = 0;

function serveExpiredSession(refreshStatus: number): void {
    server.use(
        http.get(`${API}/guilds/7`, () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })),
        http.post(`${API}/auth/refresh`, () => {
            refreshCalls += 1;
            return HttpResponse.json({ message: 'unavailable' }, { status: refreshStatus });
        }),
    );
}

function renderPage() {
    return renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'] });
}

beforeEach(() => { activateWowPlugin(); refreshCalls = 0; localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('GuildPage — expired session (ROK-1947)', () => {
    it('a 401 with no session marker shows the sign-in prompt, not the generic error', async () => {
        serveExpiredSession(503);
        renderPage();
        const prompt = await screen.findByTestId('guild-session-expired');
        expect(prompt, 'a 401 must explain the session expired').toHaveTextContent(COPY);
        expect(screen.queryByTestId('guild-error'), 'the generic retry box must not show for a 401').toBeNull();
    });

    it('a 401 that survives an indeterminate refresh (503) offers Sign in and saves the hub as the destination', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        serveExpiredSession(503);
        renderPage();
        await screen.findByTestId('guild-session-expired');
        expect(refreshCalls, 'the transparent refresh must have been tried first').toBeGreaterThan(0);
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(sessionStorage.getItem('authRedirect'), 'sign-in must return the viewer to this hub').toBe('/hubs/7');
    });
});
