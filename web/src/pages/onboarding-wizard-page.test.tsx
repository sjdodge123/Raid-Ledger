import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnboardingWizardPage } from './onboarding-wizard-page';

// Mock the hooks
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('../hooks/use-auth', () => ({
    useAuth: vi.fn(),
    isAdmin: vi.fn(),
    getAuthToken: () => 'test-token',
    // ROK-1797: the want-to-play batch hook scopes its cache key to the viewer.
    useViewerCacheScope: () => 'anon',
}));

vi.mock('../hooks/use-onboarding-fte', () => ({
    useCompleteOnboardingFte: vi.fn(() => ({
        mutate: vi.fn((_, options) => {
            options?.onSuccess?.();
        }),
        isPending: false,
    })),
    useResetOnboarding: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
}));

vi.mock('../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(() => ({
        games: [],
        isLoading: false,
    })),
}));

vi.mock('../stores/plugin-store', () => ({
    usePluginStore: vi.fn((selector: (s: { activeSlugs: Set<string> }) => unknown) =>
        selector({ activeSlugs: new Set() }),
    ),
}));

vi.mock('../hooks/use-games-discover', () => ({
    useGamesDiscover: vi.fn(() => ({
        data: {
            rows: [
                {
                    title: 'Popular Games',
                    games: [
                        {
                            id: 1,
                            name: 'Test Game',
                            slug: 'test-game',
                            coverUrl: null,
                            genres: [12],
                            gameModes: [],
                            summary: null,
                            rating: null,
                            aggregatedRating: null,
                            popularity: null,
                            themes: [],
                            platforms: [],
                            screenshots: [],
                            videos: [],
                            firstReleaseDate: null,
                            playerCount: null,
                            twitchGameId: null,
                            crossplay: null,
                        },
                    ],
                },
            ],
        },
        isLoading: false,
    })),
}));

vi.mock('../hooks/use-game-search', () => ({
    useGameSearch: vi.fn(() => ({
        data: null,
        isLoading: false,
    })),
}));

vi.mock('../hooks/use-want-to-play', () => ({
    useWantToPlay: vi.fn(() => ({
        wantToPlay: false,
        count: 0,
        toggle: vi.fn(),
        isToggling: false,
    })),
}));

vi.mock('../hooks/use-character-mutations', () => ({
    useCreateCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
    useUpdateCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
    useSetMainCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
}));

vi.mock('../lib/toast', () => ({
    toast: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../hooks/use-system-status', () => ({
    useSystemStatus: vi.fn(() => ({
        data: { discordConfigured: false },
    })),
}));

vi.mock('../hooks/use-discord-onboarding', () => ({
    useGuildMembership: vi.fn(() => ({
        data: { isMember: false },
        isLoading: false,
    })),
    useServerInvite: vi.fn(() => ({
        data: { url: null, guildName: null },
        isLoading: false,
    })),
}));

/**
 * Tech-debt [12]: the Steam status query, driven per test. Defaults to a
 * settled "not linked" answer — irrelevant unless `steamConfigured` is on.
 */
const steamStatus = vi.hoisted(() => ({
    current: { isLoading: false, data: { linked: false } } as {
        isLoading: boolean; data: { linked: boolean } | undefined;
    },
}));
vi.mock('../hooks/use-steam-link', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../hooks/use-steam-link')>();
    return {
        ...actual,
        useSteamLink: () => ({ ...actual.useSteamLink(), steamStatus: steamStatus.current }),
    };
});

/** ROK-2022: the Calendar step flag, driven per test (its own logic is unit-tested beside it). */
const calendarFlag = vi.hoisted(() => ({ current: { needsCalendarConnect: false, settled: true } }));
vi.mock('./onboarding-wizard/use-calendar-step-flag', () => ({ useCalendarStepFlag: () => calendarFlag.current }));
/** The stub opens a dialog on the real escape-layer stack, as the Apple connect sheet does (Codex P2). */
vi.mock('../components/onboarding/calendar-step', async () => {
    const { useState } = await import('react');
    const { useEscapeLayer } = await import('../hooks/use-escape-layer');
    const { useCalendarOAuthFeedback } = await import('../components/features/calendar-sync/use-calendar-oauth-feedback');
    const extraParams = ['resume'];
    function CalendarStep() {
        const [open, setOpen] = useState(false);
        useEscapeLayer(open, () => setOpen(false));
        useCalendarOAuthFeedback(extraParams); // as the real step: strips resume + connected / error on mount

        return (
            <div data-testid="calendar-step-stub">
                Calendar step
                <button type="button" onClick={() => setOpen(true)}>Open stub dialog</button>
                {open && <div data-testid="calendar-stub-dialog" />}
            </div>
        );
    }
    return { CalendarStep };
});
/** Hearted games, driven per test (ROK-2022: a resume must wait for them). */
vi.mock('../hooks/use-user-profile', () => ({
    useUserHeartedGames: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

import { useAuth, isAdmin } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useUserHeartedGames } from '../hooks/use-user-profile';

const mockUseSystemStatus = useSystemStatus as unknown as ReturnType<typeof vi.fn>;

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mockIsAdmin = isAdmin as unknown as ReturnType<typeof vi.fn>;

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function LocationProbe() {
    const loc = useLocation();
    return <span data-testid="location">{loc.pathname + loc.search}</span>;
}

function wizardTree(ui: React.ReactElement, initialEntries: string[], client = createQueryClient()) {
    return (
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={initialEntries}>
                <Routes>
                    <Route path="/onboarding" element={ui} />
                    <Route path="/calendar" element={<div>Calendar Page</div>} />
                </Routes>
                <LocationProbe />
            </MemoryRouter>
        </QueryClientProvider>
    );
}

function renderWithRouter(ui: React.ReactElement, initialEntries = ['/onboarding']) {
    return render(wizardTree(ui, initialEntries));
}

describe('OnboardingWizardPage — part 1', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAdmin.mockReturnValue(false);
    });

    it('redirects admin users to calendar', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'admin',
                role: 'admin',
                discordId: '123',
                onboardingCompletedAt: null,
            },
        });
        mockIsAdmin.mockReturnValue(true);

        renderWithRouter(<OnboardingWizardPage />);

        expect(screen.getByText('Calendar Page')).toBeInTheDocument();
    });

    it('allows admin to access wizard with ?rerun=1', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'admin',
                role: 'admin',
                discordId: '123',
                onboardingCompletedAt: '2026-02-01T00:00:00Z',
            },
        });
        mockIsAdmin.mockReturnValue(true);

        renderWithRouter(<OnboardingWizardPage />, ['/onboarding?rerun=1']);

        expect(screen.queryByText('Calendar Page')).not.toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('redirects users who already completed onboarding', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'testuser',
                role: 'member',
                discordId: '123',
                onboardingCompletedAt: '2026-02-01T00:00:00Z',
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        expect(screen.getByText('Calendar Page')).toBeInTheDocument();
    });

});

describe('OnboardingWizardPage — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAdmin.mockReturnValue(false);
    });

    it('allows re-run when ?rerun=1 even if onboarding completed', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'testuser',
                role: 'member',
                discordId: '123',
                onboardingCompletedAt: '2026-02-01T00:00:00Z',
            },
        });

        renderWithRouter(<OnboardingWizardPage />, ['/onboarding?rerun=1']);

        // Should NOT redirect — wizard should render
        expect(screen.queryByText('Calendar Page')).not.toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders wizard for new users with Discord (skips connect step)', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
                discordId: '12345',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        // No connect step, no character step = Games, GameTime, Connection,
        // Personalize = 4 steps (ROK-1374 added Connection).
        expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
        // First step should be Games
        expect(screen.getByText(/what do you play\?/i)).toBeInTheDocument();
    });

    it('offers a Connection step between Game Time and Personalize (ROK-1374)', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
                discordId: '12345',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
        const at = (needle: string) => labels.findIndex((t) => t.includes(needle));
        expect(at('Connection')).toBeGreaterThan(at('Game Time'));
        expect(at('Connection')).toBeLessThan(at('Personalize'));
    });

    it('shows connect step for local-auth user without Discord', () => {
        mockUseSystemStatus.mockReturnValue({
            data: { discordConfigured: true },
        });
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'localuser',
                role: 'member',
                discordId: 'local:localuser',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        // Connect + Games + GameTime + Connection + Personalize = 5 steps
        // Discord join step is NOT shown when user hasn't linked Discord yet (ROK-403)
        expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
        expect(screen.getByText(/connect your account/i)).toBeInTheDocument();
    });

});

describe('OnboardingWizardPage — part 3', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAdmin.mockReturnValue(false);
    });

    it('shows Skip All button on non-final steps', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
                discordId: '123',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        expect(screen.getByText(/skip all/i)).toBeInTheDocument();
    });

    it('dismisses wizard on Escape key', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
                discordId: '123',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/calendar', { replace: true });
        });
    });

    it('dismisses wizard on Skip All click', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
                discordId: '123',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        fireEvent.click(screen.getByText(/skip all/i));

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/calendar', { replace: true });
        });
    });

});

describe('OnboardingWizardPage — Steam step settles first (tech-debt [12])', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAdmin.mockReturnValue(false);
        mockUseAuth.mockReturnValue({
            user: { id: 1, username: 'newuser', role: 'member', discordId: '123', onboardingCompletedAt: null },
        });
        mockUseSystemStatus.mockReturnValue({
            data: { discordConfigured: false, steamConfigured: true },
        });
        steamStatus.current = { isLoading: true, data: undefined };
    });

    /** One provider tree, so `rerender` keeps the wizard's step state. */
    function renderStable(): () => void {
        const client = createQueryClient();
        const tree = (): React.ReactElement => (
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={['/onboarding']}>
                    <Routes><Route path="/onboarding" element={<OnboardingWizardPage />} /></Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
        const { rerender } = render(tree());
        return () => rerender(tree());
    }

    it('shows no step while Steam status is loading, so Games is never displaced by a late Steam step', () => {
        const refresh = renderStable();
        // The bug: Games rendered as step 1 here, then the Steam step was
        // inserted at index 0 when the status landed and the wizard jumped back.
        expect(
            screen.queryByText(/what do you play\?/i),
            'Games must not be reachable before the Steam step is known',
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

        steamStatus.current = { isLoading: false, data: { linked: false } };
        refresh();
        expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
        expect(screen.getByText(/connect your steam account/i)).toBeInTheDocument();
    });

    it('stays on Games when Steam status re-renders after the user reached it', () => {
        const refresh = renderStable();
        steamStatus.current = { isLoading: false, data: { linked: false } };
        refresh();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText(/what do you play\?/i)).toBeInTheDocument();

        // A background refetch with the same answer must not move the wizard.
        steamStatus.current = { isLoading: false, data: { linked: false } };
        refresh();
        expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();
        expect(screen.getByText(/what do you play\?/i)).toBeInTheDocument();
    });

    it('ignores Escape during the blank gate render, then Escape skips all once settled', () => {
        const refresh = renderStable();
        // The bug: the window Escape listener was live while the wizard
        // rendered nothing, so a stray key skipped onboarding unseen.
        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
        expect(
            mockNavigate,
            'Escape before the step list settles must not skip onboarding',
        ).not.toHaveBeenCalled();

        steamStatus.current = { isLoading: false, data: { linked: false } };
        refresh();
        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
        expect(mockNavigate).toHaveBeenCalledWith('/calendar', { replace: true });
    });
});

describe('OnboardingWizardPage — Calendar step (ROK-2022)', () => {
    const newUser = { id: 1, username: 'newuser', role: 'member', discordId: '12345', onboardingCompletedAt: null };

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAdmin.mockReturnValue(false);
        mockUseSystemStatus.mockReturnValue({ data: { discordConfigured: false } });
        calendarFlag.current = { needsCalendarConnect: true, settled: true };
    });

    afterEach(() => {
        vi.mocked(useGameRegistry).mockReturnValue({ games: [], isLoading: false } as unknown as ReturnType<typeof useGameRegistry>);
        vi.mocked(useUserHeartedGames).mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<typeof useUserHeartedGames>);
    });

    function crumbIndex(needle: string): number {
        return screen.getAllByRole('button').map((b) => b.textContent ?? '').findIndex((t) => t.includes(needle));
    }

    it('puts a Calendar breadcrumb after Game Time and before Connection when the flag is on', () => {
        mockUseAuth.mockReturnValue({ user: newUser });
        renderWithRouter(<OnboardingWizardPage />);
        expect(crumbIndex('Calendar'), 'Calendar must follow Game Time').toBeGreaterThan(crumbIndex('Game Time'));
        expect(crumbIndex('Calendar'), 'Calendar must precede Connection').toBeLessThan(crumbIndex('Connection'));
    });

    it('has no Calendar step when the flag is off (switch off / already connected)', () => {
        calendarFlag.current = { needsCalendarConnect: false, settled: true };
        mockUseAuth.mockReturnValue({ user: newUser });
        renderWithRouter(<OnboardingWizardPage />);
        expect(crumbIndex('Calendar'), 'no Calendar breadcrumb').toBe(-1);
        expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    });

    it('?resume=calendar opens ON the Calendar step (Games, Game Time, Calendar → step 3 of 5)', () => {
        mockUseAuth.mockReturnValue({ user: newUser });
        renderWithRouter(<OnboardingWizardPage />, ['/onboarding?resume=calendar&connected=google']);
        expect(screen.getByText(/^Step \d+ of \d+$/), 'the OAuth return must land on the Calendar step').toHaveTextContent('Step 3 of 5');
        expect(screen.getByTestId('calendar-step-stub')).toBeInTheDocument();
    });

    it('?resume=calendar lets an onboarded user (a ?rerun=1 return) stay in the wizard', () => {
        mockUseAuth.mockReturnValue({ user: { ...newUser, onboardingCompletedAt: '2026-02-01T00:00:00Z' } });
        renderWithRouter(<OnboardingWizardPage />, ['/onboarding?resume=calendar&error=denied']);
        expect(screen.queryByText('Calendar Page'), 'stripping resume must not bounce to /calendar').toBeNull();
        expect(screen.getByText(/^Step \d+ of \d+$/), 'an onboarded return must still seek').toHaveTextContent('Step 3 of 5');
    });

    it('renders nothing while a resume waits for the overview (settled false)', () => {
        calendarFlag.current = { needsCalendarConnect: false, settled: false };
        mockUseAuth.mockReturnValue({ user: newUser });
        renderWithRouter(<OnboardingWizardPage />, ['/onboarding?resume=calendar']);
        expect(screen.queryByRole('dialog'), 'the seek needs the final step list').toBeNull();
    });

    it('waits for the character-step queries: games that load after the overview still land on Calendar', () => {
        const wow = { id: 9, name: 'World of Warcraft', shortName: 'WoW', hasRoles: true };
        const registry = vi.mocked(useGameRegistry);
        const hearted = vi.mocked(useUserHeartedGames);
        registry.mockReturnValue({ games: [], isLoading: true } as unknown as ReturnType<typeof useGameRegistry>);
        hearted.mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useUserHeartedGames>);
        mockUseAuth.mockReturnValue({ user: newUser });
        const client = createQueryClient();
        const url = ['/onboarding?resume=calendar&connected=google'];
        const { rerender } = render(wizardTree(<OnboardingWizardPage />, url, client));
        registry.mockReturnValue({ games: [wow], isLoading: false } as unknown as ReturnType<typeof useGameRegistry>);
        hearted.mockReturnValue({ data: { data: [{ name: 'World of Warcraft' }] }, isLoading: false } as unknown as ReturnType<typeof useUserHeartedGames>);
        rerender(wizardTree(<OnboardingWizardPage />, url, client));
        expect(screen.getByText(/^Step \d+ of \d+$/), 'Games, WoW, Game Time, Calendar → step 4 of 6').toHaveTextContent('Step 4 of 6');
        expect(screen.getByTestId('calendar-step-stub'), 'the late character step must not push Calendar off').toBeInTheDocument();
    });

    it('Escape in a dialog opened from the Calendar step closes only the dialog, never Skip All', () => {
        mockUseAuth.mockReturnValue({ user: newUser });
        renderWithRouter(<OnboardingWizardPage />, ['/onboarding?resume=calendar']);
        fireEvent.click(screen.getByRole('button', { name: 'Open stub dialog' }));
        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
        expect(screen.queryByTestId('calendar-stub-dialog'), 'Escape closes the top dialog').toBeNull();
        expect(mockNavigate, 'the same Escape must not skip onboarding').not.toHaveBeenCalled();
        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
        expect(mockNavigate, 'with no dialog open, Escape still skips all').toHaveBeenCalledWith('/calendar', { replace: true });
    });

    it.each(['error=denied', 'connected=google'])('an OAuth return (%s) that lands ON the step strips resume AND the outcome', (outcome) => {
        mockUseAuth.mockReturnValue({ user: newUser });
        renderWithRouter(<OnboardingWizardPage />, [`/onboarding?resume=calendar&${outcome}`]);
        expect(screen.getByTestId('calendar-step-stub')).toBeInTheDocument();
        expect(screen.getByTestId('location'), 'a reload must not re-seek or re-show the outcome').toHaveTextContent(/^\/onboarding$/);
    });

    it('a resume with no Calendar step (switch off) strips connected / error with resume', () => {
        calendarFlag.current = { needsCalendarConnect: false, settled: true };
        mockUseAuth.mockReturnValue({ user: newUser });
        renderWithRouter(<OnboardingWizardPage />, ['/onboarding?resume=calendar&error=denied']);
        expect(screen.getByTestId('location'), 'no step is there to strip the OAuth params').toHaveTextContent(/^\/onboarding$/);
    });
});
