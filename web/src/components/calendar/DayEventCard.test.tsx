import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DayEventCard } from './DayEventCard';
import type { CalendarEvent } from './CalendarView';
import type { EventResponseDto } from '@raid-ledger/contract';

// --- Mocks ---

const mockSignupMutateAsync = vi.fn();
const mockCancelMutateAsync = vi.fn();
let mockSignupIsPending = false;
let mockCancelIsPending = false;

vi.mock('../../hooks/use-signups', () => ({
    useSignup: () => ({
        mutateAsync: mockSignupMutateAsync,
        isPending: mockSignupIsPending,
    }),
    useCancelSignup: () => ({
        mutateAsync: mockCancelMutateAsync,
        isPending: mockCancelIsPending,
    }),
}));

let mockRosterData: ReturnType<typeof createMMORoster> | ReturnType<typeof createGenericRoster> | null = null;
let mockRosterLoading = false;

vi.mock('../../hooks/use-roster', () => ({
    useRoster: () => ({
        data: mockRosterData,
        isLoading: mockRosterLoading,
    }),
}));

let mockUser: { id: number; username: string } | null = null;
let mockIsAuthenticated = false;

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: mockUser,
        isAuthenticated: mockIsAuthenticated,
    }),
}));

vi.mock('../events/signup-confirmation-modal', () => ({
    SignupConfirmationModal: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="confirm-modal">Confirm Modal</div> : null,
}));

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// --- Helpers ---

function createMockEvent(overrides: Partial<EventResponseDto> = {}): CalendarEvent {
    const resource: EventResponseDto = {
        id: 1,
        title: 'Test Raid',
        description: 'A test event',
        startTime: '2026-02-10T20:00:00Z',
        endTime: '2026-02-10T23:00:00Z',
        creator: { id: 10, username: 'RaidLeader', avatar: null },
        game: { id: 1, name: 'World of Warcraft', slug: 'wow', coverUrl: null },
        signupCount: 3,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
        ...overrides,
    };
    return {
        id: resource.id,
        title: resource.title,
        start: new Date(resource.startTime),
        end: resource.endTime ? new Date(resource.endTime) : new Date(resource.startTime),
        resource,
    };
}

function createMMORoster(opts: {
    userId?: number;
    assignments?: Array<{ slot: string; position: number; userId: number }>;
} = {}) {
    return {
        eventId: 1,
        pool: [] as Array<{ id: number; signupId: number; userId: number; discordId: string; username: string; avatar: null; slot: null; position: number; isOverride: boolean; character: null }>,
        assignments: (opts.assignments ?? []).map((a, i) => ({
            id: i + 1,
            signupId: i + 100,
            userId: a.userId,
            discordId: `discord-${a.userId}`,
            username: `User${a.userId}`,
            avatar: null,
            slot: a.slot,
            position: a.position,
            isOverride: false,
            character: null,
        })),
        slots: { tank: 2, healer: 4, dps: 14, flex: 5 },
    };
}

function createGenericRoster(opts: {
    userId?: number;
    playerCount?: number;
} = {}) {
    const count = opts.playerCount ?? 3;
    return {
        eventId: 1,
        pool: [] as Array<{ id: number; signupId: number; userId: number; discordId: string; username: string; avatar: null; slot: null; position: number; isOverride: boolean; character: null }>,
        assignments: Array.from({ length: count }, (_, i) => ({
            id: i + 1,
            signupId: i + 100,
            userId: 200 + i,
            discordId: `discord-${200 + i}`,
            username: `Player${i + 1}`,
            avatar: null,
            slot: 'player' as const,
            position: i + 1,
            isOverride: false,
            character: null,
        })),
        slots: { player: 10, bench: 2 },
    };
}

const noopOverlap = () => false;

function renderCard(event?: CalendarEvent, overlapFn?: (s: Date, e: Date) => boolean) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <DayEventCard
                    event={event ?? createMockEvent()}
                    eventOverlapsGameTime={overlapFn ?? noopOverlap}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// --- Tests ---

describe('DayEventCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUser = null;
        mockIsAuthenticated = false;
        mockRosterData = null;
        mockRosterLoading = false;
        mockSignupIsPending = false;
        mockCancelIsPending = false;
    });

    it('renders event title and game name', () => {
        renderCard();
        expect(screen.getByText('Test Raid')).toBeInTheDocument();
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });

    it('shows "Login to join" when unauthenticated', () => {
        mockRosterData = createMMORoster();
        renderCard();
        expect(screen.getByText('Login to join')).toBeInTheDocument();
    });

    it('renders login link pointing to /login with redirect', () => {
        mockRosterData = createMMORoster();
        renderCard();
        const link = screen.getByText('Login to join');
        expect(link).toHaveAttribute('href', '/login?redirect=/calendar');
    });

    it('shows role buttons for MMO game when authenticated and not signed up', () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterData = createMMORoster({
            assignments: [
                { slot: 'healer', position: 1, userId: 200 },
            ],
        });

        renderCard();

        expect(screen.getByText('Tank 0/2')).toBeInTheDocument();
        expect(screen.getByText('Healer 1/4')).toBeInTheDocument();
        expect(screen.getByText('DPS 0/14')).toBeInTheDocument();
        expect(screen.getByText('Flex 0/5')).toBeInTheDocument();
    });

    it('shows generic Join button for non-MMO game', () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterData = createGenericRoster({ playerCount: 3 });

        renderCard();

        expect(screen.getByText('Join (3/12 players)')).toBeInTheDocument();
    });

    it('shows Leave button when user is signed up', () => {
        mockUser = { id: 200, username: 'Player1' };
        mockIsAuthenticated = true;
        mockRosterData = createGenericRoster({ playerCount: 3 });

        renderCard();

        expect(screen.getByText('Leave')).toBeInTheDocument();
    });

    it('shows no action buttons for ended events', () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterData = createGenericRoster();

        const pastEvent = createMockEvent({
            startTime: '2020-01-01T10:00:00Z',
            endTime: '2020-01-01T13:00:00Z',
        });

        renderCard(pastEvent);

        expect(screen.queryByText('Join')).not.toBeInTheDocument();
        expect(screen.queryByText('Leave')).not.toBeInTheDocument();
        expect(screen.queryByText('Login to join')).not.toBeInTheDocument();
    });

    it('disables full role buttons', () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterData = createMMORoster({
            assignments: [
                { slot: 'tank', position: 1, userId: 201 },
                { slot: 'tank', position: 2, userId: 202 },
            ],
        });

        renderCard();

        const tankBtn = screen.getByText('Tank 2/2');
        expect(tankBtn.closest('button')).toBeDisabled();
    });

    it('button clicks stop propagation', () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterData = createGenericRoster({ playerCount: 0 });

        const parentClick = vi.fn();
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <div onClick={parentClick}>
                        <DayEventCard
                            event={createMockEvent()}
                            eventOverlapsGameTime={noopOverlap}
                        />
                    </div>
                </MemoryRouter>
            </QueryClientProvider>,
        );

        const joinBtn = screen.getByText('Join (0/12 players)');
        fireEvent.click(joinBtn);

        expect(parentClick).not.toHaveBeenCalled();
    });

    it('shows shimmer placeholder while roster is loading', () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterLoading = true;

        const { container } = renderCard();

        expect(container.querySelector('.day-event-actions-shimmer')).toBeInTheDocument();
    });

    it('calls signup with role and position for MMO role click', async () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterData = createMMORoster();
        mockSignupMutateAsync.mockResolvedValueOnce({ id: 42 });

        renderCard();

        const tankBtn = screen.getByText('Tank 0/2');
        fireEvent.click(tankBtn);

        expect(mockSignupMutateAsync).toHaveBeenCalledWith({
            slotRole: 'tank',
            slotPosition: 1,
        });
    });

    it('shows confirmation modal after MMO signup for game with registryId', async () => {
        mockUser = { id: 99, username: 'TestUser' };
        mockIsAuthenticated = true;
        mockRosterData = createMMORoster();
        mockSignupMutateAsync.mockResolvedValueOnce({ id: 42 });

        const event = createMockEvent({
            game: { id: 1, name: 'WoW', slug: 'wow', coverUrl: null, registryId: 'wow-registry' },
        });

        renderCard(event);

        const tankBtn = screen.getByText('Tank 0/2');
        await fireEvent.click(tankBtn);

        // Wait for the async handler
        await vi.waitFor(() => {
            expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
        });
    });

    it('calls cancelSignup on Leave click', () => {
        mockUser = { id: 200, username: 'Player1' };
        mockIsAuthenticated = true;
        mockRosterData = createGenericRoster({ playerCount: 3 });
        mockCancelMutateAsync.mockResolvedValueOnce(undefined);

        renderCard();

        const leaveBtn = screen.getByText('Leave');
        fireEvent.click(leaveBtn);

        expect(mockCancelMutateAsync).toHaveBeenCalled();
    });

    it('renders duration string', () => {
        renderCard();
        expect(screen.getByText('3h')).toBeInTheDocument();
    });

    it('renders description preview', () => {
        renderCard();
        expect(screen.getByText('A test event')).toBeInTheDocument();
    });

    it('renders creator name', () => {
        renderCard();
        expect(screen.getByText('by RaidLeader')).toBeInTheDocument();
    });
});
