/**
 * event-detail-deep-link.test.tsx
 *
 * Tests for ROK-536: Deep-link query params auto-open cancel/reschedule modals.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../test/mocks/server';
import { http, HttpResponse } from 'msw';
import type { EventResponseDto } from '@raid-ledger/contract';

// Mock IntersectionObserver for jsdom
beforeAll(() => {
    if (typeof globalThis.IntersectionObserver === 'undefined') {
        globalThis.IntersectionObserver = class IntersectionObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof globalThis.IntersectionObserver;
    }
});

const API_BASE = 'http://localhost:3000';

// ─── Hook mocks ────────────────────────────────────────────────────────────

let mockUser: { id: number; username: string; role: string } | null = null;
let mockIsAuthenticated = false;

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: mockUser,
        isAuthenticated: mockIsAuthenticated,
    }),
    isOperatorOrAdmin: () => false,
    getAuthToken: () => 'mock-token',
}));

vi.mock('../../hooks/use-signups', () => ({
    useSignup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCancelSignup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateSignupStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/use-roster', () => ({
    useRoster: () => ({ data: null, isLoading: false }),
    useUpdateRoster: () => ({ mutateAsync: vi.fn() }),
    useSelfUnassign: () => ({ mutateAsync: vi.fn() }),
    useAdminRemoveUser: () => ({ mutateAsync: vi.fn() }),
    buildRosterUpdate: vi.fn(),
}));

vi.mock('../../hooks/use-auto-unbench', () => ({
    useUpdateAutoUnbench: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../hooks/use-pugs', () => ({
    useCreatePug: () => ({ mutateAsync: vi.fn() }),
    useDeletePug: () => ({ mutateAsync: vi.fn() }),
    usePugs: () => ({ data: null }),
    useRegeneratePugInviteCode: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../hooks/use-voice-roster', () => ({
    useVoiceRoster: () => ({ participants: [], channelName: null }),
}));

vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: () => ({
        data: { data: [], meta: { total: 0 } },
        isLoading: false,
        isError: false,
        error: null,
    }),
}));

vi.mock('../../hooks/use-notif-read-sync', () => ({
    useNotifReadSync: () => {},
}));

// ─── Component mocks ───────────────────────────────────────────────────────

vi.mock('../../components/events/signup-confirmation-modal', () => ({
    SignupConfirmationModal: () => null,
}));

vi.mock('../../components/events/EventBanner', () => ({
    EventBanner: () => <div data-testid="event-banner">Banner</div>,
}));

vi.mock('../../components/roster', () => ({
    RosterBuilder: () => null,
}));

vi.mock('../../components/events/AttendanceTracker', () => ({
    AttendanceTracker: () => null,
}));

vi.mock('../../components/events/LiveBadge', () => ({
    LiveBadge: () => null,
}));

vi.mock('../../components/events/VoiceRoster', () => ({
    VoiceRoster: () => null,
}));

vi.mock('../../components/features/game-time/GameTimeWidget', () => ({
    GameTimeWidget: () => null,
}));

vi.mock('../../plugins', () => ({
    PluginSlot: () => null,
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the lazy-loaded modals as test doubles that expose their open state
vi.mock('../../components/events/cancel-event-modal', () => ({
    CancelEventModal: ({ isOpen, initialReason }: { isOpen: boolean; initialReason?: string }) =>
        isOpen ? (
            <div data-testid="cancel-modal">
                Cancel Modal
                {initialReason && <span data-testid="cancel-reason">{initialReason}</span>}
            </div>
        ) : null,
}));

vi.mock('../../components/events/RescheduleModal', () => ({
    RescheduleModal: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="reschedule-modal">Reschedule Modal</div> : null,
}));

// Import the page after all mocks
import { EventDetailPage } from '../event-detail-page';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockEvent(overrides: Partial<EventResponseDto> = {}): EventResponseDto {
    return {
        id: 42,
        title: 'Test MMO Event',
        description: 'A test event',
        startTime: '2099-02-20T20:00:00Z',
        endTime: '2099-02-20T23:00:00Z',
        creator: { id: 10, username: 'Creator', avatar: null },
        game: { id: 1, name: 'World of Warcraft', slug: 'wow', coverUrl: null },
        signupCount: 5,
        createdAt: '2099-01-01T00:00:00Z',
        updatedAt: '2099-01-01T00:00:00Z',
        ...overrides,
    };
}

function setupHandlers(event: EventResponseDto) {
    server.use(
        http.get(`${API_BASE}/events/:id`, () => HttpResponse.json(event)),
        http.get(`${API_BASE}/events/:id/roster`, () =>
            HttpResponse.json({ eventId: event.id, signups: [], count: 0 }),
        ),
        http.get(`${API_BASE}/games/configured`, () =>
            HttpResponse.json({ data: [], meta: { total: 0 } }),
        ),
        http.get(`${API_BASE}/users/me/characters`, () =>
            HttpResponse.json({ data: [], meta: { total: 0 } }),
        ),
        http.get(`${API_BASE}/events/:id/voice-channel`, () =>
            HttpResponse.json(null),
        ),
    );
}

function renderPage(initialRoute: string) {
    const qc = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={[initialRoute]}>
                <Routes>
                    <Route path="/events/:id" element={<EventDetailPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('EventDetailPage deep-link actions (ROK-536)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set as the event creator (id: 10 matches creator.id)
        mockUser = { id: 10, username: 'Creator', role: 'member' };
        mockIsAuthenticated = true;
    });

    it('auto-opens cancel modal from ?action=cancel', async () => {
        const event = createMockEvent();
        setupHandlers(event);
        renderPage('/events/42?action=cancel');

        await waitFor(() => {
            expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();
        });
    });

    it('auto-opens reschedule modal from ?action=reschedule', async () => {
        const event = createMockEvent();
        setupHandlers(event);
        renderPage('/events/42?action=reschedule');

        await waitFor(() => {
            expect(screen.getByTestId('reschedule-modal')).toBeInTheDocument();
        });
    });

    it('passes decoded reason to cancel modal', async () => {
        const event = createMockEvent();
        setupHandlers(event);
        renderPage('/events/42?action=cancel&reason=Not%20enough%20tanks');

        await waitFor(() => {
            expect(screen.getByTestId('cancel-reason')).toHaveTextContent('Not enough tanks');
        });
    });

    it('does NOT auto-open modal for non-creator', async () => {
        mockUser = { id: 99, username: 'Visitor', role: 'member' };
        const event = createMockEvent();
        setupHandlers(event);
        renderPage('/events/42?action=cancel');

        // Wait for event to load, then verify no modal
        await waitFor(() => {
            expect(screen.getByTestId('event-banner')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('cancel-modal')).not.toBeInTheDocument();
    });
});
