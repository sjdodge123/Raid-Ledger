import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { NoShowPatterns } from './no-show-patterns';

const API_BASE = 'http://localhost:3000';

const mockUsers = [
    {
        userId: 1,
        username: 'Alice',
        avatar: null,
        totalEvents: 10,
        attended: 7,
        noShow: 3,
        excused: 0,
        attendanceRate: 0.7,
    },
    {
        userId: 2,
        username: 'Bob',
        avatar: null,
        totalEvents: 8,
        attended: 6,
        noShow: 2,
        excused: 0,
        attendanceRate: 0.75,
    },
    {
        userId: 3,
        username: 'Carol',
        avatar: null,
        totalEvents: 5,
        attended: 4,
        noShow: 1, // below threshold, NOT a repeat offender
        excused: 0,
        attendanceRate: 0.8,
    },
];

describe('NoShowPatterns', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: mockUsers, totalUsers: 3 }),
            ),
        );
    });

    it('renders No-Show Patterns heading', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('No-Show Patterns')).toBeInTheDocument();
        });
    });

    it('renders Repeat Offenders section label', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('Repeat Offenders')).toBeInTheDocument();
        });
    });

    it('renders users with 2+ no-shows as repeat offenders', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            // Alice (3 no-shows) and Bob (2 no-shows) qualify
            expect(screen.getByText('Alice')).toBeInTheDocument();
            expect(screen.getByText('Bob')).toBeInTheDocument();
        });
    });

    it('does NOT show users with only 1 no-show as repeat offenders', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => screen.getByText('Alice'));
        // Carol has only 1 no-show — should not appear
        expect(screen.queryByText('Carol')).not.toBeInTheDocument();
    });

    it('shows no-show count for each repeat offender', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('3 no-shows')).toBeInTheDocument();
            expect(screen.getByText('2 no-shows')).toBeInTheDocument();
        });
    });

    it('shows no-show rate percentage', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            // Alice: 3/10 = 30%
            expect(screen.getByText('(30% of 10 events)')).toBeInTheDocument();
        });
    });

    it('shows "No repeat offenders found." when no users have 2+ no-shows', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({
                    users: [
                        { userId: 1, username: 'CleanUser', avatar: null, totalEvents: 5, attended: 5, noShow: 1, excused: 0, attendanceRate: 1.0 },
                    ],
                    totalUsers: 1,
                }),
            ),
        );

        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('No repeat offenders found.')).toBeInTheDocument();
        });
    });

    it('shows "No repeat offenders found." when user list is empty', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: [], totalUsers: 0 }),
            ),
        );

        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('No repeat offenders found.')).toBeInTheDocument();
        });
    });

    it('sorts repeat offenders by no-show count descending', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => screen.getByText('Alice'));

        const offenderItems = screen
            .getAllByText(/no-shows/)
            .map((el) => el.textContent);
        // 3 no-shows should come before 2 no-shows
        expect(offenderItems[0]).toContain('3');
        expect(offenderItems[1]).toContain('2');
    });

    it('renders Day-of-Week Activity section', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('Day-of-Week Activity')).toBeInTheDocument();
        });
    });

    it('renders all 7 day labels in the heatmap', async () => {
        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('Sun')).toBeInTheDocument();
            expect(screen.getByText('Mon')).toBeInTheDocument();
            expect(screen.getByText('Tue')).toBeInTheDocument();
            expect(screen.getByText('Wed')).toBeInTheDocument();
            expect(screen.getByText('Thu')).toBeInTheDocument();
            expect(screen.getByText('Fri')).toBeInTheDocument();
            expect(screen.getByText('Sat')).toBeInTheDocument();
        });
    });

    it('shows error state when request fails', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
            ),
        );

        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load no-show patterns.')).toBeInTheDocument();
        });
    });

    it('shows loading skeleton while data is fetching', () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, async () => {
                await new Promise((r) => setTimeout(r, 100));
                return HttpResponse.json({ users: mockUsers, totalUsers: 3 });
            }),
        );

        const { container } = renderWithProviders(<NoShowPatterns />);
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('limits display to 10 repeat offenders max', async () => {
        // Create 12 users each with 2+ no-shows
        const manyOffenders = Array.from({ length: 12 }, (_, i) => ({
            userId: i + 1,
            username: `Player${i + 1}`,
            avatar: null,
            totalEvents: 10,
            attended: 7,
            noShow: 3,
            excused: 0,
            attendanceRate: 0.7,
        }));

        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: manyOffenders, totalUsers: 12 }),
            ),
        );

        renderWithProviders(<NoShowPatterns />);
        await waitFor(() => screen.getByText('Player1'));

        const noShowElements = screen.getAllByText('3 no-shows');
        expect(noShowElements.length).toBeLessThanOrEqual(10);
    });
});
