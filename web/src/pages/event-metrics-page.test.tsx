import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { EventMetricsPage } from './event-metrics-page';
import type { EventMetricsResponseDto } from '@raid-ledger/contract';

// Mock Recharts to avoid canvas rendering issues
vi.mock('recharts', () => ({
    PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
    Pie: () => null,
    Cell: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Tooltip: () => null,
}));

// Mock react-router-dom useParams
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useParams: () => ({ id: '10' }),
    };
});

const API_BASE = 'http://localhost:3000';

const mockMetrics: EventMetricsResponseDto = {
    eventId: 10,
    title: 'Epic Raid Night',
    startTime: '2026-01-15T18:00:00.000Z',
    endTime: '2026-01-15T21:00:00.000Z',
    game: {
        id: 1,
        name: 'World of Warcraft',
        coverUrl: null,
    },
    attendanceSummary: {
        attended: 8,
        noShow: 2,
        excused: 1,
        unmarked: 1,
        total: 12,
        attendanceRate: 0.73,
    },
    voiceSummary: null,
    rosterBreakdown: [
        {
            userId: 1,
            username: 'Alice',
            avatar: null,
            attendanceStatus: 'attended',
            voiceClassification: null,
            voiceDurationSec: null,
            signupStatus: 'signed_up',
        },
        {
            userId: 2,
            username: 'Bob',
            avatar: null,
            attendanceStatus: 'no_show',
            voiceClassification: null,
            voiceDurationSec: null,
            signupStatus: 'signed_up',
        },
    ],
};

describe('EventMetricsPage', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, () =>
                HttpResponse.json(mockMetrics),
            ),
        );
    });

    it('renders event title', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Epic Raid Night')).toBeInTheDocument();
        });
    });

    it('renders game name badge', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
        });
    });

    it('renders Back to event link', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('← Back to event')).toBeInTheDocument();
        });
    });

    it('renders Attendance Summary section', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Attendance Summary')).toBeInTheDocument();
        });
    });

    it('renders Roster Breakdown section', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Roster Breakdown')).toBeInTheDocument();
        });
    });

    it('renders roster player names', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Alice')).toBeInTheDocument();
            expect(screen.getByText('Bob')).toBeInTheDocument();
        });
    });

    it('does NOT render voice timeline section when voiceSummary is null', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => screen.getByText('Roster Breakdown'));
        expect(screen.queryByText('Voice Timeline')).not.toBeInTheDocument();
    });

    it('renders voice timeline section when voiceSummary has sessions', async () => {
        const metricsWithVoice: EventMetricsResponseDto = {
            ...mockMetrics,
            voiceSummary: {
                totalTracked: 1,
                full: 1,
                partial: 0,
                late: 0,
                earlyLeaver: 0,
                noShow: 0,
                sessions: [
                    {
                        id: 1,
                        eventId: 10,
                        userId: 1,
                        discordUserId: 'discord-1',
                        discordUsername: 'Alice#1234',
                        firstJoinAt: '2026-01-15T18:10:00.000Z',
                        lastLeaveAt: '2026-01-15T20:55:00.000Z',
                        totalDurationSec: 9900,
                        segments: [
                            {
                                joinAt: '2026-01-15T18:10:00.000Z',
                                leaveAt: '2026-01-15T20:55:00.000Z',
                                durationSec: 9900,
                            },
                        ],
                        classification: 'full',
                    },
                ],
            },
        };

        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, () =>
                HttpResponse.json(metricsWithVoice),
            ),
        );

        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Voice Timeline')).toBeInTheDocument();
        });
    });

    it('shows error state when metrics request fails', async () => {
        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, () =>
                HttpResponse.json({ message: 'Event not found' }, { status: 404 }),
            ),
        );

        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Failed to load event metrics')).toBeInTheDocument();
        });
    });

    it('shows error message from API in error state', async () => {
        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, () =>
                HttpResponse.json({ message: 'Event not found' }, { status: 404 }),
            ),
        );

        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Event not found')).toBeInTheDocument();
        });
    });

    it('shows Back to event link in error state', async () => {
        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, () =>
                HttpResponse.json({ message: 'Error' }, { status: 500 }),
            ),
        );

        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            // In error state, there's also a "Back to event" link
            expect(screen.getByText('Back to event')).toBeInTheDocument();
        });
    });

    it('shows loading skeleton while data is fetching', () => {
        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, async () => {
                await new Promise((r) => setTimeout(r, 100));
                return HttpResponse.json(mockMetrics);
            }),
        );

        const { container } = renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('does not render game name badge when game is null', async () => {
        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, () =>
                HttpResponse.json({ ...mockMetrics, game: null }),
            ),
        );

        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => screen.getByText('Epic Raid Night'));
        expect(screen.queryByText('World of Warcraft')).not.toBeInTheDocument();
    });

    it('renders voice status columns in roster when voice data is present', async () => {
        const metricsWithVoice: EventMetricsResponseDto = {
            ...mockMetrics,
            voiceSummary: {
                totalTracked: 1,
                full: 1,
                partial: 0,
                late: 0,
                earlyLeaver: 0,
                noShow: 0,
                sessions: [
                    {
                        id: 1,
                        eventId: 10,
                        userId: 1,
                        discordUserId: 'discord-1',
                        discordUsername: 'Alice#1234',
                        firstJoinAt: '2026-01-15T18:10:00.000Z',
                        lastLeaveAt: '2026-01-15T20:55:00.000Z',
                        totalDurationSec: 9900,
                        segments: [],
                        classification: 'full',
                    },
                ],
            },
            rosterBreakdown: [
                {
                    userId: 1,
                    username: 'Alice',
                    avatar: null,
                    attendanceStatus: 'attended',
                    voiceClassification: 'full',
                    voiceDurationSec: 9900,
                    signupStatus: 'signed_up',
                },
            ],
        };

        server.use(
            http.get(`${API_BASE}/events/:id/metrics`, () =>
                HttpResponse.json(metricsWithVoice),
            ),
        );

        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => {
            expect(screen.getByText('Voice Status')).toBeInTheDocument();
            expect(screen.getByText('Voice Duration')).toBeInTheDocument();
        });
    });

    it('does not render voice status columns in roster when no voice data', async () => {
        renderWithProviders(<EventMetricsPage />, {
            initialEntries: ['/events/10/metrics'],
        });
        await waitFor(() => screen.getByText('Roster Breakdown'));
        expect(screen.queryByText('Voice Status')).not.toBeInTheDocument();
        expect(screen.queryByText('Voice Duration')).not.toBeInTheDocument();
    });
});
