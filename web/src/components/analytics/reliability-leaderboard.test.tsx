import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { ReliabilityLeaderboard } from './reliability-leaderboard';

const API_BASE = 'http://localhost:3000';

const mockUsers = [
    {
        userId: 1,
        username: 'Alice',
        avatar: null,
        totalEvents: 10,
        attended: 9,
        noShow: 1,
        excused: 0,
        attendanceRate: 0.9,
        lateCount: 1,
    },
    {
        userId: 2,
        username: 'Bob',
        avatar: null,
        totalEvents: 8,
        attended: 4,
        noShow: 3,
        excused: 1,
        attendanceRate: 0.5,
        lateCount: 0,
    },
    {
        userId: 3,
        username: 'Carol',
        avatar: null,
        totalEvents: 5,
        attended: 2,
        noShow: 2,
        excused: 1,
        attendanceRate: 0.4,
        lateCount: 2,
    },
];

describe('ReliabilityLeaderboard — part 1', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: mockUsers, totalUsers: 3 }),
            ),
        );
    });

    it('renders Reliability Leaderboard heading', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => {
            expect(screen.getByText('Reliability Leaderboard')).toBeInTheDocument();
        });
    });

    it('renders column headers', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => {
            expect(screen.getByText('Player')).toBeInTheDocument();
            expect(screen.getByText('Events')).toBeInTheDocument();
            expect(screen.getByText('Attendance %')).toBeInTheDocument();
            expect(screen.getByText('Late')).toBeInTheDocument();
            expect(screen.getByText('No-Shows')).toBeInTheDocument();
        });
    });

    it('renders usernames', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => {
            expect(screen.getByText('Alice')).toBeInTheDocument();
            expect(screen.getByText('Bob')).toBeInTheDocument();
            expect(screen.getByText('Carol')).toBeInTheDocument();
        });
    });

    it('renders attendance percentages (90%, 50%, 40%)', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => {
            expect(screen.getByText('90%')).toBeInTheDocument();
            expect(screen.getByText('50%')).toBeInTheDocument();
            expect(screen.getByText('40%')).toBeInTheDocument();
        });
    });

    it('renders rank numbers in rank column', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));

        // Rank cells are in the first <td> column (text-muted)
        const rankCells = document
            .querySelectorAll('td.text-muted');
        // Among muted cells, rank 1, 2, 3 should be present
        const cellTexts = Array.from(rankCells).map((c) => c.textContent?.trim());
        expect(cellTexts).toContain('1');
        expect(cellTexts).toContain('2');
        expect(cellTexts).toContain('3');
    });

});

describe('ReliabilityLeaderboard — part 2', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: mockUsers, totalUsers: 3 }),
            ),
        );
    });

    it('shows empty state when no users', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: [], totalUsers: 0 }),
            ),
        );

        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => {
            expect(screen.getByText('No attendance data recorded yet.')).toBeInTheDocument();
        });
    });

    it('shows error state when request fails', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
            ),
        );

        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => {
            expect(screen.getByText('Failed to load reliability data.')).toBeInTheDocument();
        });
    });

    it('default sort is by attendanceRate descending', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));

        // Alice (90%) should appear first in the table
        const rows = screen.getAllByRole('row');
        // rows[0] = thead, rows[1] = first data row
        expect(rows[1]?.textContent).toContain('Alice');
    });

    it('clicking Attendance % header re-sorts to ascending', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));

        // Click Attendance % once to toggle from desc -> asc
        await user.click(screen.getByText('Attendance %'));

        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            // Carol (40%) should now be first ascending
            expect(rows[1]?.textContent).toContain('Carol');
        });
    });

    it('clicking Player header sorts by username', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));

        // Click Player — new column so defaults to desc
        await user.click(screen.getByText('Player'));

        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            // Desc by username: Carol > Bob > Alice
            expect(rows[1]?.textContent).toContain('Carol');
        });
    });

});

describe('ReliabilityLeaderboard — part 3', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: mockUsers, totalUsers: 3 }),
            ),
        );
    });

    it('clicking same header again toggles sort direction', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));

        // First click on No-Shows: desc (Bob=3 first)
        await user.click(screen.getByText('No-Shows'));
        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            expect(rows[1]?.textContent).toContain('Bob');
        });

        // Second click: asc (Alice=1 first)
        await user.click(screen.getByText('No-Shows'));
        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            expect(rows[1]?.textContent).toContain('Alice');
        });
    });

    it('shows loading skeleton while data is fetching', () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, async () => {
                await new Promise((r) => setTimeout(r, 100));
                return HttpResponse.json({ users: mockUsers, totalUsers: 3 });
            }),
        );

        const { container } = renderWithProviders(<ReliabilityLeaderboard />);
        // Loading skeleton uses animate-pulse
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

});

const FOOTNOTE =
    "Attendance % includes late arrivals. Late counts players who joined the event's voice channel after the start and stayed for at least a fifth of it.";

function headerLabels() {
    return screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[\u2191\u2193]/g, '').trim());
}

/** Late is the 5th cell: # · Player · Events · Attendance % · Late · No-Shows. */
function lateCellFor(username: string) {
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes(username));
    return row?.querySelectorAll('td')[4]?.textContent;
}

function usernameOrder() {
    return screen.getAllByRole('row').slice(1).map((r) => r.querySelectorAll('td')[1]?.textContent);
}

describe('ReliabilityLeaderboard — Late column (ROK-1938)', () => {
    beforeEach(() => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: mockUsers, totalUsers: 3 }),
            ),
        );
    });

    it('puts the Late header between Attendance % and No-Shows', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));
        expect(headerLabels()).toEqual(['#', 'Player', 'Events', 'Attendance %', 'Late', 'No-Shows']);
    });

    it('renders each player\'s late count in the Late cell', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));
        expect([lateCellFor('Alice'), lateCellFor('Bob'), lateCellFor('Carol')]).toEqual(['1', '0', '2']);
    });

    it('renders 0 when the server omits lateCount', async () => {
        const { lateCount: _omit, ...legacy } = mockUsers[0] ?? { lateCount: 0 };
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: [legacy], totalUsers: 1 }),
            ),
        );
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));
        expect(lateCellFor('Alice')).toBe('0');
    });

    it('clicking Late sorts desc by lateCount, again sorts asc', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('Alice'));

        await user.click(screen.getByText('Late'));
        await waitFor(() => expect(usernameOrder()).toEqual(['Carol', 'Alice', 'Bob']));

        await user.click(screen.getByText('Late'));
        await waitFor(() => expect(usernameOrder()).toEqual(['Bob', 'Alice', 'Carol']));
    });

    it('shows the late footnote with data', async () => {
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => expect(screen.getByText(FOOTNOTE)).toBeInTheDocument());
    });

    it('omits the late footnote in the empty state', async () => {
        server.use(
            http.get(`${API_BASE}/analytics/attendance/users`, () =>
                HttpResponse.json({ users: [], totalUsers: 0 }),
            ),
        );
        renderWithProviders(<ReliabilityLeaderboard />);
        await waitFor(() => screen.getByText('No attendance data recorded yet.'));
        expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
    });
});
