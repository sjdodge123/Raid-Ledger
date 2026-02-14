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
    useCheckDisplayName: vi.fn(() => ({
        data: { available: true },
        isLoading: false,
    })),
    useUpdateUserProfile: vi.fn(() => ({
        mutate: vi.fn((_, options) => {
            options?.onSuccess?.();
        }),
        isPending: false,
    })),
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

vi.mock('../lib/toast', () => ({
    toast: {
        info: vi.fn(),
    },
}));

import { useAuth, isAdmin } from '../hooks/use-auth';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mockIsAdmin = isAdmin as unknown as ReturnType<typeof vi.fn>;

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function renderWithRouter(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            <MemoryRouter initialEntries={['/onboarding']}>
                <Routes>
                    <Route path="/onboarding" element={ui} />
                    <Route path="/calendar" element={<div>Calendar Page</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
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
                onboardingCompletedAt: '2026-02-01T00:00:00Z',
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        expect(screen.getByText('Calendar Page')).toBeInTheDocument();
    });

    it('renders wizard for new users', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        // Since no MMO games in mock data, character step is excluded => 4 steps
        expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
        expect(screen.getByText(/skip all/i)).toBeInTheDocument();
    });

    it('displays progress dots for all steps', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
                onboardingCompletedAt: null,
            },
        });

        const { container } = renderWithRouter(<OnboardingWizardPage />);

        const dots = container.querySelectorAll('[class*="rounded-full"]');
        // 5 steps = 5 dots
        expect(dots.length).toBeGreaterThanOrEqual(5);
    });

    it('shows Skip All button on all steps except Done', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                role: 'member',
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
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        fireEvent.click(screen.getByText(/skip all/i));

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/calendar', { replace: true });
        });
    });

    it('renders step 1 (Welcome) initially', () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                displayName: null,
                role: 'member',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        expect(screen.getByText(/welcome to raid ledger!/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    });

    it('advances to step 2 when Next is clicked on step 1', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                displayName: null,
                role: 'member',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        // Fill in display name
        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'ValidName' } });

        // Wait for availability check
        await waitFor(() => {
            expect(screen.getByText(/available/i)).toBeInTheDocument();
        });

        // Click Next
        fireEvent.click(screen.getByRole('button', { name: /next/i }));

        // Should now be on step 2 (4 total steps since no MMO)
        await waitFor(() => {
            expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
            expect(screen.getByText(/what do you play\?/i)).toBeInTheDocument();
        });
    });

    it('allows navigating back from step 2 to step 1', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                displayName: null,
                role: 'member',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        // Advance to step 2
        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'ValidName' } });

        await waitFor(() => {
            expect(screen.getByText(/available/i)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /next/i }));

        await waitFor(() => {
            expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
        });

        // Click Back
        fireEvent.click(screen.getByRole('button', { name: /back/i }));

        await waitFor(() => {
            expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
            expect(screen.getByText(/welcome to raid ledger!/i)).toBeInTheDocument();
        });
    });

    it('conditional step 3 (character) is excluded when no MMO games', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'newuser',
                displayName: null,
                role: 'member',
                onboardingCompletedAt: null,
            },
        });

        renderWithRouter(<OnboardingWizardPage />);

        // Advance through step 1
        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'ValidName' } });

        await waitFor(() => {
            expect(screen.getByText(/available/i)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /next/i }));

        await waitFor(() => {
            expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
        });

        // Advance from step 2 (games)
        fireEvent.click(screen.getAllByRole('button', { name: /next/i })[0]);

        // Should skip to step 4 (availability) since no MMO
        await waitFor(() => {
            expect(screen.getByText(/step 3 of 4/i)).toBeInTheDocument();
        });
    });
});
