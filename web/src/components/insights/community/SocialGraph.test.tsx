/**
 * SocialGraph.test.tsx (ROK-1099)
 *
 * Verifies container behavior: testid present, toggle button visible,
 * clicking toggle swaps the canvas for the accessible table fallback.
 * The canvas module is mocked so jsdom doesn't try to bootstrap WebGL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { server } from '../../../test/mocks/server';
import { SocialGraph } from './SocialGraph';

vi.mock('./SocialGraphCanvas', () => ({
    SocialGraphCanvas: () => <div data-testid="social-graph-canvas-stub">stub canvas</div>,
}));

const API = 'http://localhost:3000';

beforeEach(() => {
    server.use(
        http.get(`${API}/insights/community/social-graph`, () =>
            HttpResponse.json({
                snapshotDate: '2026-04-22',
                nodes: [
                    { userId: 1, username: 'Alice', avatar: null, intensityTier: 'Hardcore', cliqueId: 1, degree: 3 },
                    { userId: 2, username: 'Bob', avatar: null, intensityTier: 'Casual', cliqueId: 1, degree: 2 },
                ],
                edges: [{ sourceUserId: 1, targetUserId: 2, weight: 5 }],
                cliques: [{ cliqueId: 1, memberUserIds: [1, 2] }],
                tasteLeaders: [{ userId: 1, username: 'Alice', avatar: null, score: 0.9, metric: 'degree' }],
            }),
        ),
    );
});

describe('SocialGraph', () => {
    it('renders the panel testid and "Show as table" toggle', async () => {
        renderWithProviders(<SocialGraph />);
        expect(screen.getByTestId('community-insights-social-graph')).toBeInTheDocument();
        const toggle = await screen.findByRole('button', { name: /show as table/i });
        expect(toggle).toBeInTheDocument();
    });

    it('switches to fallback table on toggle', async () => {
        renderWithProviders(<SocialGraph />);
        await waitFor(() =>
            expect(screen.getByTestId('social-graph-canvas-stub')).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole('button', { name: /show as table/i }));
        await waitFor(() =>
            expect(screen.queryByTestId('social-graph-canvas-stub')).not.toBeInTheDocument(),
        );
        expect(screen.getByRole('table')).toBeInTheDocument();
    });
});
