import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { NewMembersSection } from './NewMembersSection';
import * as usePlayersModule from '../../hooks/use-players';

// Mock the useRecentPlayers hook
vi.mock('../../hooks/use-players', () => ({
    useRecentPlayers: vi.fn(),
    usePlayers: vi.fn(),
}));

// Mock the avatar utilities to avoid needing real API_BASE_URL
vi.mock('../../lib/avatar', () => ({
    resolveAvatar: vi.fn(() => ({ url: null, type: 'initials' })),
    toAvatarUser: vi.fn((user: unknown) => user),
}));

const MOCK_NOW = new Date('2026-02-13T12:00:00Z');

const createMockPlayer = (overrides: Partial<{
    id: number;
    username: string;
    avatar: string | null;
    discordId: string | null;
    customAvatarUrl: string | null;
    createdAt: string;
}> = {}) => ({
    id: 1,
    username: 'TestPlayer',
    avatar: null,
    discordId: '123456',
    customAvatarUrl: null,
    createdAt: '2026-02-11T00:00:00.000Z',
    ...overrides,
});

const renderWithRouter = (component: React.ReactNode) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
};

function newmemberssectionGroup1() {
it('renders player cards when data is available', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: {
                data: [
                    createMockPlayer({ id: 1, username: 'Alice' }),
                    createMockPlayer({ id: 2, username: 'Bob' }),
                ],
            },
            isLoading: false,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        renderWithRouter(<NewMembersSection />);

        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });

it('shows loading state with skeleton placeholders', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: undefined,
            isLoading: true,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        renderWithRouter(<NewMembersSection />);

        expect(screen.getByText('New Members')).toBeInTheDocument();
    });

}

function newmemberssectionGroup2() {
it('returns null when no recent members (empty array)', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: { data: [] },
            isLoading: false,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        const { container } = renderWithRouter(<NewMembersSection />);

        expect(container.innerHTML).toBe('');
    });

it('returns null when data is undefined and not loading', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: undefined,
            isLoading: false,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        const { container } = renderWithRouter(<NewMembersSection />);

        // players = data?.data ?? [] → [] → returns null
        expect(container.innerHTML).toBe('');
    });

}

function newmemberssectionGroup3() {
it('each card links to user profile', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: {
                data: [
                    createMockPlayer({ id: 42, username: 'ProfileUser' }),
                ],
            },
            isLoading: false,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        renderWithRouter(<NewMembersSection />);

        const link = screen.getByRole('link', { name: /ProfileUser/i });
        expect(link).toHaveAttribute('href', '/users/42');
    });

}

function newmemberssectionGroup4() {
it('displays relative time (e.g. "2 days ago")', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: {
                data: [
                    createMockPlayer({
                        id: 1,
                        username: 'RecentUser',
                        createdAt: '2026-02-11T12:00:00.000Z',
                    }),
                ],
            },
            isLoading: false,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        renderWithRouter(<NewMembersSection />);

        // formatDistanceToNow returns "2 days", component appends " ago"
        expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
    });

}

function newmemberssectionGroup5() {
it('renders the "New Members" heading when players exist', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: {
                data: [createMockPlayer()],
            },
            isLoading: false,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        renderWithRouter(<NewMembersSection />);

        expect(screen.getByText('New Members')).toBeInTheDocument();
    });

it('shows first letter initial for players without avatar', () => {
        vi.mocked(usePlayersModule.useRecentPlayers).mockReturnValue({
            data: {
                data: [
                    createMockPlayer({ id: 1, username: 'Zara' }),
                ],
            },
            isLoading: false,
        } as ReturnType<typeof usePlayersModule.useRecentPlayers>);

        renderWithRouter(<NewMembersSection />);

        expect(screen.getByText('Z')).toBeInTheDocument();
    });

}

describe('NewMembersSection', () => {
beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

afterEach(() => {
        vi.useRealTimers();
    });

    newmemberssectionGroup1();
    newmemberssectionGroup2();
    newmemberssectionGroup3();
    newmemberssectionGroup4();
    newmemberssectionGroup5();
});
