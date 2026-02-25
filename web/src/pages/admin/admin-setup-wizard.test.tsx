import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminSetupWizard } from './admin-setup-wizard';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(),
    isAdmin: vi.fn(),
}));

vi.mock('../../hooks/use-onboarding', () => ({
    useOnboarding: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
    toast: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

// Stub step components to avoid deep mock dependencies
vi.mock('../../components/admin/onboarding/secure-account-step', () => ({
    SecureAccountStep: ({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) => (
        <div data-testid="secure-account-step">
            <button onClick={onNext}>Next</button>
            <button onClick={onSkip}>Skip</button>
        </div>
    ),
}));

vi.mock('../../components/admin/onboarding/community-identity-step', () => ({
    CommunityIdentityStep: () => <div data-testid="community-identity-step" />,
}));

vi.mock('../../components/admin/onboarding/connect-plugins-step', () => ({
    ConnectPluginsStep: () => <div data-testid="connect-plugins-step" />,
}));

vi.mock('../../components/admin/onboarding/done-step', () => ({
    DoneStep: () => <div data-testid="done-step" />,
}));

import { useAuth, isAdmin } from '../../hooks/use-auth';
import { useOnboarding } from '../../hooks/use-onboarding';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mockIsAdmin = isAdmin as unknown as ReturnType<typeof vi.fn>;
const mockUseOnboarding = useOnboarding as unknown as ReturnType<typeof vi.fn>;

const defaultOnboarding = {
    statusQuery: {
        isLoading: false,
        data: {
            currentStep: 0,
            completed: false,
            steps: {
                secureAccount: false,
                communityIdentity: false,
                connectPlugins: false,
            },
        },
    },
    dataSourcesQuery: { data: null },
    updateStep: { mutate: vi.fn() },
    completeOnboarding: { mutate: vi.fn(), isPending: false },
    changePassword: { mutate: vi.fn(), isPending: false },
    updateCommunity: { mutate: vi.fn(), isPending: false },
};

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithRouter(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            <MemoryRouter initialEntries={['/admin/setup']}>
                <Routes>
                    <Route path="/admin/setup" element={ui} />
                    <Route path="/calendar" element={<div>Calendar</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

describe('AdminSetupWizard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({
            user: {
                id: 1,
                username: 'admin',
                role: 'admin',
                discordId: 'local:admin',
            },
        });
        mockIsAdmin.mockReturnValue(true);
        mockUseOnboarding.mockReturnValue(defaultOnboarding);
    });

    describe('Redirects', () => {
        it('redirects non-admin users to calendar', () => {
            mockUseAuth.mockReturnValue({
                user: { id: 2, username: 'member', role: 'member' },
            });
            mockIsAdmin.mockReturnValue(false);

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByText('Calendar')).toBeInTheDocument();
        });

        it('redirects if onboarding already completed', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: {
                    isLoading: false,
                    data: { currentStep: 0, completed: true, steps: {} },
                },
            });

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByText('Calendar')).toBeInTheDocument();
        });
    });

    describe('Loading state', () => {
        it('shows loading spinner while onboarding status loads', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: { isLoading: true, data: null },
            });

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByText(/loading setup wizard/i)).toBeInTheDocument();
        });
    });

    describe('Mobile stepper ("Step X of Y")', () => {
        it('renders mobile "Step X of Y" text on step 1', () => {
            renderWithRouter(<AdminSetupWizard />);
            // The mobile stepper element has md:hidden class (visible on mobile)
            // We verify the text content is in the DOM
            expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
        });

        it('mobile stepper shows current step label', () => {
            renderWithRouter(<AdminSetupWizard />);
            // Step 0 = Secure Account
            const mobileStepperDiv = screen.getByText(/step 1 of 4/i).closest('div');
            expect(mobileStepperDiv).not.toBeNull();
        });

        it('desktop stepper shows all step labels', () => {
            renderWithRouter(<AdminSetupWizard />);
            // These are rendered in the hidden md:flex stepper
            expect(screen.getAllByText(/secure account/i).length).toBeGreaterThan(0);
            expect(screen.getAllByText(/community/i).length).toBeGreaterThan(0);
            expect(screen.getAllByText(/plugins/i).length).toBeGreaterThan(0);
            expect(screen.getAllByText(/done/i).length).toBeGreaterThan(0);
        });

        it('mobile stepper total steps equals 4 (STEPS.length)', () => {
            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
        });
    });

    describe('Skip Setup button', () => {
        it('renders the Skip Setup button', () => {
            renderWithRouter(<AdminSetupWizard />);
            const skipButton = screen.getByRole('button', { name: /skip setup/i });
            expect(skipButton).toBeInTheDocument();
        });
    });

    describe('Step content rendering', () => {
        it('renders SecureAccountStep on step 0', () => {
            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByTestId('secure-account-step')).toBeInTheDocument();
        });

        it('renders CommunityIdentityStep on step 1', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: {
                    isLoading: false,
                    data: { currentStep: 1, completed: false, steps: {} },
                },
            });

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByTestId('community-identity-step')).toBeInTheDocument();
        });

        it('renders ConnectPluginsStep on step 2', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: {
                    isLoading: false,
                    data: { currentStep: 2, completed: false, steps: {} },
                },
            });

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByTestId('connect-plugins-step')).toBeInTheDocument();
        });

        it('renders DoneStep on step 3', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: {
                    isLoading: false,
                    data: { currentStep: 3, completed: false, steps: {} },
                },
            });

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByTestId('done-step')).toBeInTheDocument();
        });
    });

    describe('Step number display', () => {
        it('shows "Step 2 of 4" after advancing to step 1', () => {
            // Server step = 1
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: {
                    isLoading: false,
                    data: { currentStep: 1, completed: false, steps: {} },
                },
            });

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
        });

        it('shows "Step 4 of 4" on the final step', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: {
                    isLoading: false,
                    data: { currentStep: 3, completed: false, steps: {} },
                },
            });

            renderWithRouter(<AdminSetupWizard />);
            expect(screen.getByText(/step 4 of 4/i)).toBeInTheDocument();
        });
    });
});
