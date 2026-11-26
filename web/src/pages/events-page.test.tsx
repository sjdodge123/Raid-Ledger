/** ROK-2342: a failed events query is a retryable error, never "No events yet". */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { EventsPage } from './events-page';

vi.mock('../hooks/use-auth', async (importOriginal) => ({
    ...await importOriginal<typeof import('../hooks/use-auth')>(),
    useAuth: () => ({ isAuthenticated: false, user: null }),
}));
vi.mock('../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: [], isLoading: false }),
}));

const API_BASE = 'http://localhost:3000';

describe('EventsPage — ROK-2342: failed load', () => {
    it('a 500 shows the error state instead of "No events yet", and Try again refetches', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/events`, () => {
                calls += 1;
                return HttpResponse.json({ message: 'Boom' }, { status: 500 });
            }),
        );
        renderWithProviders(<EventsPage />, { initialEntries: ['/events'] });
        expect(await screen.findByRole('heading', { name: "Couldn't load events" })).toBeInTheDocument();
        expect(screen.queryByText('No events yet')).not.toBeInTheDocument();
        const before = calls;
        expect(before).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });
});
