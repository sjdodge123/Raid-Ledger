/**
 * ROK-2371 D1(a): `/auth/first-time` — both choices, the last-used primary
 * swap, create → navigates to the session hand-off, the pending-link
 * "not found" copy, the expired state and the carried invite code.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { LAST_SIGNIN_KEY } from '../lib/last-signin';
import { FirstTimePage } from './first-time-page';
import { CREATE_LABEL, EXPIRED_COPY, NOT_FOUND_COPY, existingLabel } from './first-time/first-time-copy';

const API = 'http://localhost:3000';
const VIEW = { provider: 'google', displayName: 'Roknua G', otherMethod: 'discord' } as const;

function serveView(status = 200): void {
    server.use(http.get(`${API}/auth/first-time`, () =>
        status === 200 ? HttpResponse.json(VIEW) : HttpResponse.json({ message: 'gone' }, { status })));
}

function renderAt(path: string): void {
    renderWithProviders(
        <Routes>
            <Route path="/auth/first-time" element={<FirstTimePage />} />
            <Route path="/auth/success" element={<p data-testid="success-landing">landing</p>} />
        </Routes>,
        { initialEntries: [path] },
    );
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('FirstTimePage (ROK-2371 D1a)', () => {
    it('offers both choices for the parked identity; create is primary by default', async () => {
        serveView();
        renderAt('/auth/first-time');
        expect(await screen.findByText('Roknua G')).toBeInTheDocument();
        const existing = screen.getByRole('button', { name: existingLabel('discord') });
        const create = screen.getByRole('button', { name: CREATE_LABEL });
        expect(create).toHaveAttribute('data-primary', 'true');
        expect(existing).toHaveAttribute('data-primary', 'false');
    });

    it('makes "I already have an account" primary when the last-used marker names the other method', async () => {
        localStorage.setItem(LAST_SIGNIN_KEY, JSON.stringify({ method: 'discord', name: 'Roknua', avatarUrl: null, at: 1 }));
        serveView();
        renderAt('/auth/first-time');
        const existing = await screen.findByRole('button', { name: existingLabel('discord') });
        expect(existing, 'marker names Discord → existing-account option is primary').toHaveAttribute('data-primary', 'true');
        expect(screen.getByRole('button', { name: CREATE_LABEL })).toHaveAttribute('data-primary', 'false');
    });

    it('shows the not-found copy when the other sign-in found nobody either', async () => {
        serveView();
        renderAt('/auth/first-time?error=not_found');
        expect(await screen.findByTestId('first-time-notice')).toHaveTextContent(NOT_FOUND_COPY);
        expect(screen.getByRole('button', { name: CREATE_LABEL })).toBeInTheDocument();
    });

    it('create → POSTs JSON and navigates to the session hand-off, carrying the invite', async () => {
        serveView();
        let contentType: string | null = null;
        server.use(http.post(`${API}/auth/first-time/create`, ({ request }) => {
            contentType = request.headers.get('content-type');
            return HttpResponse.json({ redirect: '/auth/success?code=abc&via=google' });
        }));
        renderAt('/auth/first-time?invite=PUG123');
        fireEvent.click(await screen.findByRole('button', { name: CREATE_LABEL }));
        expect(await screen.findByTestId('success-landing')).toBeInTheDocument();
        expect(contentType).toBe('application/json');
        expect(sessionStorage.getItem('invite_code')).toBe('PUG123');
    });

    it('a 404 view (no live pending identity) shows the expired card', async () => {
        serveView(404);
        renderAt('/auth/first-time');
        expect(await screen.findByTestId('first-time-expired')).toHaveTextContent(EXPIRED_COPY);
        expect(screen.queryByRole('button', { name: CREATE_LABEL })).toBeNull();
    });
});
