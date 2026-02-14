/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { UserEventSignups } from './UserEventSignups';
import * as useUserProfileHook from '../../hooks/use-user-profile';
import type { UserEventSignupsResponseDto, EventResponseDto } from '@raid-ledger/contract';

const createMockEvent = (overrides: Partial<EventResponseDto> = {}): EventResponseDto => ({
    id: 1,
    title: 'Test Raid Night',
    description: 'Weekly raid session',
    startTime: '2026-02-14T20:00:00Z',
    endTime: '2026-02-14T23:00:00Z',
    creator: {
        id: 1,
        username: 'TestUser',
        avatar: null,
        discordId: '123',
        customAvatarUrl: null,
    },
    game: {
        id: 1,
        registryId: 'uuid',
        name: 'World of Warcraft',
        slug: 'wow',
        coverUrl: 'https://example.com/cover.jpg',
    },
    signupCount: 3,
    slotConfig: null,
    maxAttendees: null,
    autoUnbench: true,
    contentInstances: null,
    recurrenceGroupId: null,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...overrides,
});

const renderWithProviders = (component: React.ReactElement) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                {component}
            </BrowserRouter>
        </QueryClientProvider>
    );
};

describe('UserEventSignups', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading skeleton while loading', () => {
        vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
            data: undefined,
            isLoading: true,
            error: null,
            isError: false,
        } as any);

        renderWithProviders(<UserEventSignups userId={1} />);

        expect(screen.getByText('Upcoming Events')).toBeInTheDocument();
        // Verify skeletons are rendered (they have animate-pulse class)
        const skeletons = document.querySelectorAll('.animate-pulse');
        expect(skeletons.length).toBeGreaterThan(0);
    });

    it('renders empty state when no events', () => {
        const emptyResponse: UserEventSignupsResponseDto = {
            data: [],
            total: 0,
        };

        vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
            data: emptyResponse,
            isLoading: false,
            error: null,
            isError: false,
        } as any);

        renderWithProviders(<UserEventSignups userId={1} />);

        expect(screen.getByText('Upcoming Events')).toBeInTheDocument();
        expect(screen.getByText('No upcoming events')).toBeInTheDocument();
        // Verify calendar icon is rendered
        const svg = screen.getByText('No upcoming events').parentElement?.querySelector('svg');
        expect(svg).toBeInTheDocument();
    });

    it('renders event cards when events exist', () => {
        const mockEvents: UserEventSignupsResponseDto = {
            data: [
                createMockEvent({ id: 1, title: 'Raid 1' }),
                createMockEvent({ id: 2, title: 'Raid 2' }),
            ],
            total: 2,
        };

        vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
            data: mockEvents,
            isLoading: false,
            error: null,
            isError: false,
        } as any);

        renderWithProviders(<UserEventSignups userId={1} />);

        expect(screen.getByText('Raid 1')).toBeInTheDocument();
        expect(screen.getByText('Raid 2')).toBeInTheDocument();
    });

    it('shows count badge with total events', () => {
        const mockEvents: UserEventSignupsResponseDto = {
            data: [createMockEvent()],
            total: 5,
        };

        vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
            data: mockEvents,
            isLoading: false,
            error: null,
            isError: false,
        } as any);

        renderWithProviders(<UserEventSignups userId={1} />);

        // Find the badge with the count
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('shows "View all" link when total > 6', () => {
        const mockEvents: UserEventSignupsResponseDto = {
            data: Array.from({ length: 6 }, (_, i) => createMockEvent({ id: i + 1, title: `Event ${i + 1}` })),
            total: 10,
        };

        vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
            data: mockEvents,
            isLoading: false,
            error: null,
            isError: false,
        } as any);

        renderWithProviders(<UserEventSignups userId={1} />);

        expect(screen.getByText('View all')).toBeInTheDocument();
    });

    it('does not show "View all" link when total <= 6', () => {
        const mockEvents: UserEventSignupsResponseDto = {
            data: [
                createMockEvent({ id: 1 }),
                createMockEvent({ id: 2 }),
            ],
            total: 2,
        };

        vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
            data: mockEvents,
            isLoading: false,
            error: null,
            isError: false,
        } as any);

        renderWithProviders(<UserEventSignups userId={1} />);

        expect(screen.queryByText('View all')).not.toBeInTheDocument();
    });

    it('renders in responsive grid layout', () => {
        const mockEvents: UserEventSignupsResponseDto = {
            data: [
                createMockEvent({ id: 1 }),
                createMockEvent({ id: 2 }),
                createMockEvent({ id: 3 }),
            ],
            total: 3,
        };

        vi.spyOn(useUserProfileHook, 'useUserEventSignups').mockReturnValue({
            data: mockEvents,
            isLoading: false,
            error: null,
            isError: false,
        } as any);

        const { container } = renderWithProviders(<UserEventSignups userId={1} />);

        // Verify grid classes are present (1/2/3 cols)
        const grid = container.querySelector('.grid');
        expect(grid).toHaveClass('grid-cols-1');
        expect(grid).toHaveClass('sm:grid-cols-2');
        expect(grid).toHaveClass('lg:grid-cols-3');
    });
});
