import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { GameBreakdownChart } from './game-breakdown-chart';

// Mock Recharts
vi.mock('recharts', () => ({
    BarChart: ({ children, data }: { children: React.ReactNode; data: unknown }) => (
        <div data-testid="bar-chart" data-chart={JSON.stringify(data)}>{children}</div>
    ),
    Bar: ({ dataKey, fill, name }: { dataKey: string; fill: string; name: string }) => (
        <div data-testid={`series-${dataKey}`} data-fill={fill} data-name={name} />
    ),
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
            avgLateRate: 0.12,
            totalSignups: 50,
        },
        {
            gameId: 2,
            gameName: 'Final Fantasy XIV',
            coverUrl: null,
            totalEvents: 5,
            avgAttendanceRate: 0.75,
            avgNoShowRate: 0.15,
            avgLateRate: 0.333,
            totalSignups: 25,
        },
    ],
};

function gamebreakdownchartGroup1() {
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

}

function gamebreakdownchartGroup2() {
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

}

function gamebreakdownchartGroup3() {
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

}

describe('GameBreakdownChart', () => {
beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/games`, () =>
                HttpResponse.json(mockGameData),
            ),
        );
    });

    gamebreakdownchartGroup1();
    gamebreakdownchartGroup2();
    gamebreakdownchartGroup3();
});

const LATE_FOOTNOTE = 'Late % is part of Attendance %. Events without a voice channel never show as late.';

function bars() {
    return screen.getAllByTestId(/^series-/);
}

function chartRows(): { late: number }[] {
    return JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-chart') ?? '[]') as { late: number }[];
}

describe('GameBreakdownChart — Late % series (ROK-1938)', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/games`, () => HttpResponse.json(mockGameData)),
        );
    });

    it('renders Attendance, Late, No-Show bars in that order', async () => {
        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => screen.getByTestId('bar-chart'));
        expect(bars().map((b) => b.getAttribute('data-testid'))).toEqual(['series-attendance', 'series-late', 'series-noShow']);
        expect(bars().map((b) => b.getAttribute('data-name'))).toEqual(['Attendance %', 'Late %', 'No-Show %']);
    });

    it('fills the series with semantic tokens, never a hex', async () => {
        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => screen.getByTestId('bar-chart'));
        const fills = bars().map((b) => b.getAttribute('data-fill'));
        expect(fills).toEqual(['var(--color-success)', 'var(--color-warning)', 'var(--color-danger)']);
        expect(fills.filter((f) => f?.startsWith('#'))).toEqual([]);
    });

    it('rounds avgLateRate to a whole percent per game', async () => {
        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => screen.getByTestId('bar-chart'));
        expect(chartRows().map((r) => r.late)).toEqual([12, 33]);
    });

    it('treats a missing avgLateRate as 0', async () => {
        const legacy = mockGameData.games.map(({ avgLateRate: _omit, ...g }) => g);
        server.use(
            http.get(`${API_BASE}/analytics/attendance/games`, () => HttpResponse.json({ games: legacy })),
        );
        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => screen.getByTestId('bar-chart'));
        expect(chartRows().map((r) => r.late)).toEqual([0, 0]);
    });

    it('shows the Late % footnote with data, not in the empty state', async () => {
        const { unmount } = renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => expect(screen.getByText(LATE_FOOTNOTE)).toBeInTheDocument());
        unmount();
        server.use(http.get(`${API_BASE}/analytics/attendance/games`, () => HttpResponse.json({ games: [] })));
        renderWithProviders(<GameBreakdownChart />);
        await waitFor(() => screen.getByText('No per-game attendance data yet.'));
        expect(screen.queryByText(LATE_FOOTNOTE)).not.toBeInTheDocument();
    });
});
