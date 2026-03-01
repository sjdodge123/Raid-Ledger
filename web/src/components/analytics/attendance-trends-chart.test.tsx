import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { AttendanceTrendsChart } from './attendance-trends-chart';

// Mock Recharts to avoid canvas/svg complexity in jsdom
vi.mock('recharts', () => ({
    LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const API_BASE = 'http://localhost:3000';

const mockTrendsData = {
    period: '30d',
    dataPoints: [
        { date: '2026-01-15', attended: 8, noShow: 2, excused: 1, total: 11 },
        { date: '2026-01-22', attended: 10, noShow: 1, excused: 0, total: 11 },
    ],
    summary: {
        avgAttendanceRate: 0.82,
        avgNoShowRate: 0.14,
        totalEvents: 2,
    },
};

describe('AttendanceTrendsChart', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance`, () =>
                HttpResponse.json(mockTrendsData),
            ),
        );
    });

    it('renders Attendance Trends heading', async () => {
        renderWithProviders(<AttendanceTrendsChart />);
        await waitFor(() => {
            expect(screen.getByText('Attendance Trends')).toBeInTheDocument();
        });
    });

    it('shows period toggle buttons (30 Days, 90 Days)', async () => {
        renderWithProviders(<AttendanceTrendsChart />);
        expect(screen.getByRole('button', { name: '30 Days' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '90 Days' })).toBeInTheDocument();
    });

    it('renders summary stats after data loads', async () => {
        renderWithProviders(<AttendanceTrendsChart />);
        await waitFor(() => {
            expect(screen.getByText('82%')).toBeInTheDocument(); // 0.82 * 100
            expect(screen.getByText('14%')).toBeInTheDocument(); // 0.14 * 100
            expect(screen.getByText('2')).toBeInTheDocument();   // totalEvents
        });
    });

    it('renders summary stat labels', async () => {
        renderWithProviders(<AttendanceTrendsChart />);
        await waitFor(() => {
            expect(screen.getByText('Avg Attendance')).toBeInTheDocument();
            expect(screen.getByText('Avg No-Show')).toBeInTheDocument();
            expect(screen.getByText('Total Events')).toBeInTheDocument();
        });
    });

    it('renders line chart when data is loaded', async () => {
        renderWithProviders(<AttendanceTrendsChart />);
        await waitFor(() => {
            expect(screen.getByTestId('line-chart')).toBeInTheDocument();
        });
    });

    it('shows empty state when no data points', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance`, () =>
                HttpResponse.json({
                    period: '30d',
                    dataPoints: [],
                    summary: { avgAttendanceRate: 0, avgNoShowRate: 0, totalEvents: 0 },
                }),
            ),
        );

        renderWithProviders(<AttendanceTrendsChart />);
        await waitFor(() => {
            expect(screen.getByText('No attendance data for this period.')).toBeInTheDocument();
        });
    });

    it('shows error state when request fails', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance`, () =>
                HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
            ),
        );

        renderWithProviders(<AttendanceTrendsChart />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load attendance trends.')).toBeInTheDocument();
        });
    });

    it('clicking 90 Days button requests 90d period', async () => {
        const user = userEvent.setup();
        let capturedUrl = '';

        server.use(
            http.get(`${API_BASE}/analytics/attendance`, ({ request }) => {
                capturedUrl = request.url;
                return HttpResponse.json(mockTrendsData);
            }),
        );

        renderWithProviders(<AttendanceTrendsChart />);

        // Wait for initial load
        await waitFor(() => screen.getByText('Attendance Trends'));

        await user.click(screen.getByRole('button', { name: '90 Days' }));

        await waitFor(() => {
            expect(capturedUrl).toContain('period=90d');
        });
    });

    it('clicking 30 Days button keeps 30d period', async () => {
        const user = userEvent.setup();
        renderWithProviders(<AttendanceTrendsChart />);

        await waitFor(() => screen.getByText('Attendance Trends'));

        // Should not throw / error
        await user.click(screen.getByRole('button', { name: '30 Days' }));
        // Still see chart
        await waitFor(() => {
            expect(screen.getByTestId('line-chart')).toBeInTheDocument();
        });
    });

    it('shows loading state while data is being fetched', () => {
        // Use slow response to catch loading state
        server.use(
            http.get(`${API_BASE}/analytics/attendance`, async () => {
                await new Promise((r) => setTimeout(r, 100));
                return HttpResponse.json(mockTrendsData);
            }),
        );

        renderWithProviders(<AttendanceTrendsChart />);
        expect(screen.getByText('Loading chart data...')).toBeInTheDocument();
    });
});
