/** ROK-2342: a failed plans query is a retryable error, never "No event plans yet". */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { EventPlansList } from './event-plans-list';

vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../hooks/use-auth')>(),
    useAuth: () => ({ isAuthenticated: true, user: { id: 1 } }),
}));
vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: [], isLoading: false }),
}));

const API_BASE = 'http://localhost:3000';

describe('EventPlansList — ROK-2342: failed load', () => {
    it('a 500 shows the error state instead of the empty state, and Try again refetches', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/event-plans/my-plans`, () => {
                calls += 1;
                return HttpResponse.json({ message: 'Boom' }, { status: 500 });
            }),
        );
        renderWithProviders(<EventPlansList />);
        expect(await screen.findByRole('heading', { name: "Couldn't load plans" })).toBeInTheDocument();
        expect(screen.queryByText('No event plans yet')).not.toBeInTheDocument();
        const before = calls;
        expect(before).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });
});
