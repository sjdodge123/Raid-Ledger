import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DoneStep } from './done-step';

vi.mock('../../../hooks/use-onboarding', () => ({
    useOnboarding: vi.fn(),
}));

import { useOnboarding } from '../../../hooks/use-onboarding';

const mockUseOnboarding = useOnboarding as unknown as ReturnType<typeof vi.fn>;

const defaultOnboarding = {
    statusQuery: {
        data: {
            steps: {
                secureAccount: false,
                communityIdentity: false,
                connectPlugins: false,
            },
        },
    },
    dataSourcesQuery: {
        data: {
            blizzard: { configured: false },
            igdb: { configured: false },
            discord: { configured: false },
        },
    },
};

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            <MemoryRouter>
                {ui}
            </MemoryRouter>
        </QueryClientProvider>
    );
}

describe('DoneStep', () => {
    const mockOnComplete = vi.fn();
    const mockGoToStep = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseOnboarding.mockReturnValue(defaultOnboarding);
    });

    describe('Rendering', () => {
        it('renders "You\'re All Set!" heading', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
        });

        it('renders the Configuration Summary section', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText(/configuration summary/i)).toBeInTheDocument();
        });

        it('renders Complete button', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
        });

        it('renders Review Settings link', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByRole('link', { name: /review settings/i })).toBeInTheDocument();
        });
    });

    describe('Touch target compliance (min-h-[44px])', () => {
        it('"Complete" button has min-h-[44px]', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const btn = screen.getByRole('button', { name: /complete/i });
            expect(btn.className).toContain('min-h-[44px]');
        });

        it('"Review Settings" link has min-h-[44px]', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const link = screen.getByRole('link', { name: /review settings/i });
            expect(link.className).toContain('min-h-[44px]');
        });

        it('summary item buttons have min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />
            );
            // Summary items are buttons
            const summaryButtons = container.querySelectorAll(
                '.space-y-2 button[type="button"]'
            );
            expect(summaryButtons.length).toBeGreaterThan(0);
            summaryButtons.forEach((btn) => {
                expect(btn.className).toContain('min-h-[44px]');
            });
        });
    });

    describe('Responsive layout for action buttons', () => {
        it('actions container uses flex-col sm:flex-row for responsive stacking', () => {
            const { container } = renderWithProviders(
                <DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />
            );
            const actionsDiv = container.querySelector('.flex.flex-col.sm\\:flex-row');
            expect(actionsDiv).not.toBeNull();
        });
    });

    describe('Configuration summary items', () => {
        it('shows all 6 configuration items', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText('Password Changed')).toBeInTheDocument();
            expect(screen.getByText('Community Identity')).toBeInTheDocument();
            expect(screen.getByText('Plugins')).toBeInTheDocument();
            expect(screen.getByText('Blizzard API')).toBeInTheDocument();
            expect(screen.getByText('IGDB / Twitch API')).toBeInTheDocument();
            expect(screen.getByText('Discord OAuth')).toBeInTheDocument();
        });

        it('shows "Skipped" status for uncompleted items', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const skippedBadges = screen.getAllByText('Skipped');
            expect(skippedBadges.length).toBeGreaterThan(0);
        });

        it('shows "Done" status for completed items', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                statusQuery: {
                    data: {
                        steps: {
                            secureAccount: true,
                            communityIdentity: false,
                            connectPlugins: false,
                        },
                    },
                },
            });

            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText('Done')).toBeInTheDocument();
        });

        it('clicking a summary item calls goToStep with correct step index', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            // Password Changed is step 0
            const passwordItem = screen.getByText('Password Changed').closest('button');
            fireEvent.click(passwordItem!);
            expect(mockGoToStep).toHaveBeenCalledWith(0);
        });

        it('clicking Community Identity calls goToStep(1)', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const communityItem = screen.getByText('Community Identity').closest('button');
            fireEvent.click(communityItem!);
            expect(mockGoToStep).toHaveBeenCalledWith(1);
        });
    });

    describe('Skipped items notice', () => {
        it('shows notice when items are skipped', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText(/complete the skipped items anytime/i)).toBeInTheDocument();
        });

        it('does not show notice when all items are completed', () => {
            mockUseOnboarding.mockReturnValue({
                statusQuery: {
                    data: {
                        steps: {
                            secureAccount: true,
                            communityIdentity: true,
                            connectPlugins: true,
                        },
                    },
                },
                dataSourcesQuery: {
                    data: {
                        blizzard: { configured: true },
                        igdb: { configured: true },
                        discord: { configured: true },
                    },
                },
            });

            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.queryByText(/complete the skipped items anytime/i)).not.toBeInTheDocument();
        });
    });

    describe('Actions', () => {
        it('calls onComplete when Complete is clicked', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            fireEvent.click(screen.getByRole('button', { name: /complete/i }));
            expect(mockOnComplete).toHaveBeenCalledOnce();
        });
    });

    describe('Edge cases', () => {
        it('handles null statusQuery data gracefully', () => {
            mockUseOnboarding.mockReturnValue({
                statusQuery: { data: null },
                dataSourcesQuery: { data: null },
            });

            // Should render without crashing
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
        });

        it('handles null dataSourcesQuery data gracefully', () => {
            mockUseOnboarding.mockReturnValue({
                ...defaultOnboarding,
                dataSourcesQuery: { data: null },
            });

            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
        });
    });
});
