import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { GameBreakdownChart } from './game-breakdown-chart';

// Mock Recharts
vi.mock('recharts', () => ({
    BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const API_BASE = 'http://localhost:3000';

const mockGameData = {
    games: [
        {
            gameId: 1,
            gameName: 'World of Warcraft',
            coverUrl: null,
            totalEvents: 10,
            avgAttendanceRate: 0.8,
            avgNoShowRate: 0.1,
            totalSignups: 50,
        },
        {
            gameId: 2,
            gameName: 'Final Fantasy XIV',
            coverUrl: null,
            totalEvents: 5,
            avgAttendanceRate: 0.75,
            avgNoShowRate: 0.15,
            totalSignups: 25,
        },
    ],
};

describe('GameBreakdownChart', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/games`, () =>
                HttpResponse.json(mockGameData),
            ),
        );
    });

    it('renders Per-Game Breakdown heading', async () => {
        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => {
            expect(screen.getByText('Per-Game Breakdown')).toBeInTheDocument();
        });
    });

    it('renders bar chart when data is loaded', async () => {
        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => {
            expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
        });
    });

    it('shows empty state when no game data', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/games`, () =>
                HttpResponse.json({ games: [] }),
            ),
        );

        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => {
            expect(screen.getByText('No per-game attendance data yet.')).toBeInTheDocument();
        });
    });

    it('shows error state when request fails', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/games`, () =>
                HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
            ),
        );

        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load game attendance data.')).toBeInTheDocument();
        });
    });

    it('shows loading state while fetching', () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/games`, async () => {
                await new Promise((r) => setTimeout(r, 100));
                return HttpResponse.json(mockGameData);
            }),
        );

        renderWithProviders(<GameBreakdownChart />);
        expect(screen.getByText('Loading chart data...')).toBeInTheDocument();
    });
});
