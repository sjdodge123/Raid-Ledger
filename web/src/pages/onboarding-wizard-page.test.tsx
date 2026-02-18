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

describe('OnboardingWizardPage', () => {
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

        // No connect step, no character step = Games, GameTime, Personalize = 3 steps
        expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
        // First step should be Games
        expect(screen.getByText(/what do you play\?/i)).toBeInTheDocument();
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

        // Connect + Games + GameTime + Personalize = 4 steps
        expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
        expect(screen.getByText(/connect your account/i)).toBeInTheDocument();
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

    describe('Mobile touch target compliance (ROK-344)', () => {
        it('Skip All button has min-h-[44px] for touch target compliance', () => {
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

            const skipAllButton = screen.getByRole('button', { name: /skip all/i });
            expect(skipAllButton.className).toContain('min-h-[44px]');
        });

        it('breadcrumb step buttons have min-w-[44px] and min-h-[44px] for touch compliance', () => {
            mockUseAuth.mockReturnValue({
                user: {
                    id: 1,
                    username: 'newuser',
                    role: 'member',
                    discordId: '123',
                    onboardingCompletedAt: null,
                },
            });

            const { container } = renderWithRouter(<OnboardingWizardPage />);

            // Breadcrumb buttons are in the breadcrumb nav section
            const breadcrumbSection = container.querySelector('.flex.items-center.justify-center.gap-0\\.5');
            expect(breadcrumbSection).not.toBeNull();
            const breadcrumbButtons = breadcrumbSection!.querySelectorAll('button[type="button"]');
            expect(breadcrumbButtons.length).toBeGreaterThan(0);
            breadcrumbButtons.forEach((btn) => {
                expect(btn.className).toContain('min-w-[44px]');
                expect(btn.className).toContain('min-h-[44px]');
            });
        });

        it('navigation Back button has min-h-[44px]', () => {
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

            // Advance one step to reveal the Back button
            const nextBtn = screen.getByRole('button', { name: /^next$/i });
            fireEvent.click(nextBtn);

            const backBtn = screen.getByRole('button', { name: /^back$/i });
            expect(backBtn.className).toContain('min-h-[44px]');
        });

        it('navigation Next button has min-h-[44px]', () => {
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

            const nextBtn = screen.getByRole('button', { name: /^next$/i });
            expect(nextBtn.className).toContain('min-h-[44px]');
        });

        it('navigation Skip button has min-h-[44px]', () => {
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

            // Skip button is next to Next
            const skipBtn = screen.getByRole('button', { name: /^skip$/i });
            expect(skipBtn.className).toContain('min-h-[44px]');
        });

        it('wizard modal is responsive (mx-4 margin for small screens)', () => {
            mockUseAuth.mockReturnValue({
                user: {
                    id: 1,
                    username: 'newuser',
                    role: 'member',
                    discordId: '123',
                    onboardingCompletedAt: null,
                },
            });

            const { container } = renderWithRouter(<OnboardingWizardPage />);
            const dialog = container.querySelector('[role="dialog"]');
            expect(dialog).not.toBeNull();
            expect(dialog!.className).toContain('mx-4');
        });
    });
});
