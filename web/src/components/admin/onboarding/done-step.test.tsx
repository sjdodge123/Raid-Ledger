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

    function configurationSummaryItemsGroup1() {
it('shows all 6 configuration items', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.getByText('Password Changed')).toBeInTheDocument();
            expect(screen.getByText('Community Identity')).toBeInTheDocument();
            expect(screen.getByText('Discord')).toBeInTheDocument();
            expect(screen.queryByText('Plugins')).not.toBeInTheDocument();
            expect(screen.getByText('Blizzard API')).toBeInTheDocument();
            expect(screen.getByText('IGDB / Twitch API')).toBeInTheDocument();
            expect(screen.getByText('Discord OAuth')).toBeInTheDocument();
        });

it('shows "Skipped" status for uncompleted items', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const skippedBadges = screen.getAllByText('Skipped');
            expect(skippedBadges.length).toBeGreaterThan(0);
        });

    }

    function configurationSummaryItemsGroup2() {
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

    }

    function configurationSummaryItemsGroup3() {
it('clicking Community Identity calls goToStep(1)', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const communityItem = screen.getByText('Community Identity').closest('button');
            fireEvent.click(communityItem!);
            expect(mockGoToStep).toHaveBeenCalledWith(1);
        });

it('ROK-1703: the Discord and Discord OAuth rows jump to the Discord step (2)', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            for (const label of ['Discord', 'Discord OAuth']) {
                const row = screen.getByText(label).closest('button');
                if (!row) throw new Error(`no row button for ${label}`);
                fireEvent.click(row);
                expect(mockGoToStep).toHaveBeenLastCalledWith(2);
            }
        });

it('ROK-1703: the Blizzard and IGDB rows link to their admin pages, never into the Discord step', () => {
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const rows: [string, string][] = [['Blizzard API', '/admin/settings/plugins'], ['IGDB / Twitch API', '/admin/settings/integrations/igdb']];
            for (const [label, href] of rows) {
                const link = screen.getByText(label).closest('a');
                expect(link, `${label} row should be a link`).not.toBeNull();
                expect(link?.getAttribute('href')).toBe(href);
                if (link) fireEvent.click(link);
            }
            expect(mockGoToStep).not.toHaveBeenCalled();
        });

it('ROK-1703: shows the Discord-link line only once Discord sign-in is configured', () => {
            const base = { statusQuery: { data: { steps: { discord: true } } } };
            mockUseOnboarding.mockReturnValue({ ...base, dataSourcesQuery: { data: { discord: { configured: false } } } });
            const { unmount } = renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            expect(screen.queryByTestId('discord-link-note')).not.toBeInTheDocument();
            unmount();
            mockUseOnboarding.mockReturnValue({ ...base, dataSourcesQuery: { data: { discord: { configured: true } } } });
            renderWithProviders(<DoneStep onComplete={mockOnComplete} goToStep={mockGoToStep} />);
            const note = screen.getByTestId('discord-link-note');
            expect(note).toHaveTextContent('Next: link this admin account to your Discord user in Profile → Integrations.');
            // Plain Discord sign-in would create a separate user; the profile's link flow links this admin.
            expect(screen.getByRole('link', { name: 'Profile → Integrations' })).toHaveAttribute('href', '/profile/integrations');
        });

    }

    describe('Configuration summary items', () => {
        configurationSummaryItemsGroup1();
        configurationSummaryItemsGroup2();
        configurationSummaryItemsGroup3();
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
                            discord: true,
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

describe('DoneStep — cloud flavour hides Secure Account (ROK-1701 OQ-8b)', () => {
    const mockGoToStep = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseOnboarding.mockReturnValue(defaultOnboarding);
    });

    it.each(['Password Changed'])('"%s" keeps its status but has no edit affordance', (label) => {
        renderWithProviders(<DoneStep onComplete={vi.fn()} goToStep={mockGoToStep} firstStep={1} />);
        const row = screen.getByText(label);
        expect(row.closest('button')).toBeNull();
        fireEvent.click(row);
        expect(mockGoToStep).not.toHaveBeenCalled();
        expect(screen.getAllByText('Skipped')).toHaveLength(6);
    });

    it('rows on visible steps stay editable', () => {
        renderWithProviders(<DoneStep onComplete={vi.fn()} goToStep={mockGoToStep} firstStep={1} />);
        const community = screen.getByText('Community Identity').closest('button');
        expect(community).not.toBeNull();
        if (community) fireEvent.click(community);
        expect(mockGoToStep).toHaveBeenCalledWith(1);
        // ROK-1703: three wizard-step rows; Blizzard and IGDB are links to their admin pages.
        expect(screen.getAllByRole('button', { name: /Skipped/ })).toHaveLength(3);
        expect(screen.getAllByRole('link', { name: /Skipped/ })).toHaveLength(2);
    });
});
