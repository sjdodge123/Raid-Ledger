import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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

import { useAuth, isAdmin } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';

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

function renderWithRouter(ui: React.ReactElement, initialEntries = ['/onboarding']) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            <MemoryRouter initialEntries={initialEntries}>
                <Routes>
                    <Route path="/onboarding" element={ui} />
                    <Route path="/calendar" element={<div>Calendar Page</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
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
});
