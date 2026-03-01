/**
 * event-detail-signup.test.tsx
 *
 * Tests for the ROK-600 fix: character selection modal gating logic.
 *
 * The modal should only appear when:
 * - The game has hasRoles: true (MMO with tank/healer/dps), OR
 * - The user has existing characters for that game
 *
 * For non-MMO games with no characters, signup should be direct (no modal).
 *
 * We test both the pure decision logic and the component behavior via mocked hooks.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../test/mocks/server';
import { http, HttpResponse } from 'msw';
import type { EventResponseDto, GameRegistryDto } from '@raid-ledger/contract';

// Mock IntersectionObserver for jsdom (used by EventBanner collapsible header)
beforeAll(() => {
    if (typeof globalThis.IntersectionObserver === 'undefined') {
        globalThis.IntersectionObserver = class IntersectionObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof globalThis.IntersectionObserver;
    }
});

// ─── Pure logic: shouldShowCharacterModal ────────────────────────────────────
//
// In event-detail-page.tsx, the logic is:
//   const gameHasRoles = gameRegistryEntry?.hasRoles ?? event?.game?.hasRoles ?? false;
//   const gameId = event?.game?.id;
//   const userHasCharactersForGame = (myCharsData?.data?.length ?? 0) > 0;
//   const shouldShowCharacterModal = !!gameId && (gameHasRoles || userHasCharactersForGame);

interface ModalGateInput {
    gameId: number | undefined;
    gameHasRoles: boolean;
    userHasCharacters: boolean;
}

function deriveShouldShowCharacterModal(input: ModalGateInput): boolean {
    return !!input.gameId && (input.gameHasRoles || input.userHasCharacters);
}

describe('shouldShowCharacterModal logic (ROK-600)', () => {
    it('shows modal for MMO game (hasRoles: true)', () => {
        expect(deriveShouldShowCharacterModal({
            gameId: 1,
            gameHasRoles: true,
            userHasCharacters: false,
        })).toBe(true);
    });

    it('skips modal for non-MMO game with no characters', () => {
        expect(deriveShouldShowCharacterModal({
            gameId: 2,
            gameHasRoles: false,
            userHasCharacters: false,
        })).toBe(false);
    });

    it('shows modal for non-MMO game when user has characters', () => {
        expect(deriveShouldShowCharacterModal({
            gameId: 2,
            gameHasRoles: false,
            userHasCharacters: true,
        })).toBe(true);
    });

    it('skips modal when event has no game', () => {
        expect(deriveShouldShowCharacterModal({
            gameId: undefined,
            gameHasRoles: false,
            userHasCharacters: false,
        })).toBe(false);
    });

    it('skips modal when event has no game even if hasRoles is somehow true', () => {
        expect(deriveShouldShowCharacterModal({
            gameId: undefined,
            gameHasRoles: true,
            userHasCharacters: false,
        })).toBe(false);
    });

    it('shows modal for MMO game even when user also has characters', () => {
        expect(deriveShouldShowCharacterModal({
            gameId: 1,
            gameHasRoles: true,
            userHasCharacters: true,
        })).toBe(true);
    });
});

// ─── Component tests: signup flow with mocked hooks ──────────────────────────

const API_BASE = 'http://localhost:3000';

const mockSignupMutateAsync = vi.fn();
const mockCancelMutateAsync = vi.fn();

vi.mock('../../hooks/use-signups', () => ({
    useSignup: () => ({
        mutateAsync: mockSignupMutateAsync,
        isPending: false,
    }),
    useCancelSignup: () => ({
        mutateAsync: mockCancelMutateAsync,
        isPending: false,
    }),
    useUpdateSignupStatus: () => ({
        mutateAsync: vi.fn(),
        isPending: false,
    }),
}));

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

let mockMyCharactersData: { data: Array<{ id: string; name: string }>; meta: { total: number } } = { data: [], meta: { total: 0 } };

vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: () => ({
        data: mockMyCharactersData,
        isLoading: false,
        isError: false,
        error: null,
    }),
}));

vi.mock('../../hooks/use-notif-read-sync', () => ({
    useNotifReadSync: () => {},
}));

// Mock the lazy-loaded SignupConfirmationModal to be a simple test double
vi.mock('../../components/events/signup-confirmation-modal', () => ({
    SignupConfirmationModal: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="character-modal">Character Selection Modal</div> : null,
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

// Need to import the actual page after all mocks are in place
import { EventDetailPage } from '../event-detail-page';

function createMockEventResponse(overrides: Partial<EventResponseDto> = {}): EventResponseDto {
    return {
        id: 1,
        title: 'Test Event',
        description: 'A test event',
        startTime: '2099-02-20T20:00:00Z',
        endTime: '2099-02-20T23:00:00Z',
        creator: { id: 10, username: 'Creator', avatar: null },
        game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: null },
        signupCount: 0,
        createdAt: '2099-01-01T00:00:00Z',
        updatedAt: '2099-01-01T00:00:00Z',
        ...overrides,
    };
}

function setupMSWHandlers(event: EventResponseDto, opts: {
    gameRegistry?: GameRegistryDto[];
    userCharacters?: Array<{ id: string; name: string }>;
} = {}) {
    server.use(
        http.get(`${API_BASE}/events/:id`, () =>
            HttpResponse.json(event),
        ),
        http.get(`${API_BASE}/events/:id/roster`, () =>
            HttpResponse.json({
                eventId: event.id,
                signups: [],
                count: 0,
            }),
        ),
        http.get(`${API_BASE}/games/configured`, () =>
            HttpResponse.json(opts.gameRegistry ? { data: opts.gameRegistry, meta: { total: opts.gameRegistry.length } } : { data: [], meta: { total: 0 } }),
        ),
        http.get(`${API_BASE}/users/me/characters`, () =>
            HttpResponse.json({
                data: opts.userCharacters ?? [],
                meta: { total: opts.userCharacters?.length ?? 0 },
            }),
        ),
        http.get(`${API_BASE}/events/:id/voice-channel`, () =>
            HttpResponse.json(null),
        ),
    );
}

function renderEventDetailPage() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/events/1']}>
                <Routes>
                    <Route path="/events/:id" element={<EventDetailPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('EventDetailPage signup flow (ROK-600)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUser = { id: 99, username: 'TestUser', role: 'member' };
        mockIsAuthenticated = true;
        mockMyCharactersData = { data: [], meta: { total: 0 } };
    });

    it('shows character modal for MMO game event', async () => {
        const event = createMockEventResponse({
            game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: null, hasRoles: true },
        });
        setupMSWHandlers(event, {
            gameRegistry: [{
                id: 1, slug: 'world-of-warcraft', name: 'World of Warcraft',
                hasRoles: true, hasSpecs: true, enabled: true, maxCharactersPerUser: 10,
                shortName: 'WoW', coverUrl: null, colorHex: null,
            }],
        });

        renderEventDetailPage();

        // Wait for the event to load and the signup button to appear
        const signupBtn = await screen.findByRole('button', { name: /sign up for event/i });
        fireEvent.click(signupBtn);

        // The character modal should appear
        await waitFor(() => {
            expect(screen.getByTestId('character-modal')).toBeInTheDocument();
        });
        // Direct signup should NOT have been called
        expect(mockSignupMutateAsync).not.toHaveBeenCalled();
    });

    it('direct signup for non-MMO game event (no modal)', async () => {
        const event = createMockEventResponse({
            game: { id: 2, name: 'GTA V', slug: 'gta-v', coverUrl: null, hasRoles: false },
        });
        setupMSWHandlers(event, {
            gameRegistry: [{
                id: 2, slug: 'gta-v', name: 'GTA V',
                hasRoles: false, hasSpecs: false, enabled: true, maxCharactersPerUser: 5,
                shortName: 'GTA', coverUrl: null, colorHex: null,
            }],
            userCharacters: [], // No characters
        });

        mockSignupMutateAsync.mockResolvedValueOnce({ id: 1 });

        renderEventDetailPage();

        const signupBtn = await screen.findByRole('button', { name: /sign up for event/i });
        fireEvent.click(signupBtn);

        // The modal should NOT appear
        expect(screen.queryByTestId('character-modal')).not.toBeInTheDocument();
        // Direct signup should have been called
        await waitFor(() => {
            expect(mockSignupMutateAsync).toHaveBeenCalled();
        });
    });

    it('direct signup for event with no game (no modal)', async () => {
        const event = createMockEventResponse({
            game: null,
        });
        setupMSWHandlers(event);

        mockSignupMutateAsync.mockResolvedValueOnce({ id: 1 });

        renderEventDetailPage();

        const signupBtn = await screen.findByRole('button', { name: /sign up for event/i });
        fireEvent.click(signupBtn);

        // The modal should NOT appear
        expect(screen.queryByTestId('character-modal')).not.toBeInTheDocument();
        // Direct signup should have been called
        await waitFor(() => {
            expect(mockSignupMutateAsync).toHaveBeenCalled();
        });
    });

    it('shows character modal for non-MMO game when user has characters', async () => {
        // Set up characters data synchronously via the mocked hook
        mockMyCharactersData = {
            data: [{ id: 'char-uuid-1', name: 'Captain Jack' }],
            meta: { total: 1 },
        };

        const event = createMockEventResponse({
            game: { id: 2, name: 'Sea of Thieves', slug: 'sea-of-thieves', coverUrl: null, hasRoles: false },
        });
        setupMSWHandlers(event, {
            gameRegistry: [{
                id: 2, slug: 'sea-of-thieves', name: 'Sea of Thieves',
                hasRoles: false, hasSpecs: false, enabled: true, maxCharactersPerUser: 5,
                shortName: 'SoT', coverUrl: null, colorHex: null,
            }],
        });

        renderEventDetailPage();

        const signupBtn = await screen.findByRole('button', { name: /sign up for event/i });
        fireEvent.click(signupBtn);

        // The character modal SHOULD appear (user has characters for this non-MMO game)
        await waitFor(() => {
            expect(screen.getByTestId('character-modal')).toBeInTheDocument();
        });
        expect(mockSignupMutateAsync).not.toHaveBeenCalled();
    });
});
