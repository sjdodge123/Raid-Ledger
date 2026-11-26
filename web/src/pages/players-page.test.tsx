/** ROK-2342: a failed players query is a retryable error, never "No players found". */
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { PlayersPage } from './players-page';

const API_BASE = 'http://localhost:3000';

describe('PlayersPage — ROK-2342: failed load', () => {
    it('a 500 shows the error state instead of "No players found", and Try again refetches', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/users`, () => {
                calls += 1;
                return HttpResponse.json({ message: 'Boom' }, { status: 500 });
            }),
            http.get(`${API_BASE}/users/recent`, () => HttpResponse.json({ data: [] })),
        );
        renderWithProviders(<PlayersPage />, { initialEntries: ['/players'] });
        expect(await screen.findByRole('heading', { name: "Couldn't load players" })).toBeInTheDocument();
        expect(screen.queryByText('No players found')).not.toBeInTheDocument();
        const before = calls;
        expect(before).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });
});
