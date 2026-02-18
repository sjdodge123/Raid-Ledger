import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectPluginsStep } from './connect-plugins-step';

vi.mock('../../../hooks/use-plugin-admin', () => ({
    usePluginAdmin: vi.fn(),
}));

vi.mock('../../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

import { usePluginAdmin } from '../../../hooks/use-plugin-admin';

const mockUsePluginAdmin = usePluginAdmin as unknown as ReturnType<typeof vi.fn>;

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            {ui}
        </QueryClientProvider>
    );
}

describe('ConnectPluginsStep', () => {
    const mockOnNext = vi.fn();
    const mockOnBack = vi.fn();
    const mockOnSkip = vi.fn();

    const defaultPluginAdmin = {
        plugins: { isLoading: false, isError: false, data: [] },
        install: { mutateAsync: vi.fn(), isPending: false },
        activate: { mutateAsync: vi.fn(), isPending: false },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUsePluginAdmin.mockReturnValue(defaultPluginAdmin);
    });

    describe('Loading state', () => {
        it('shows loading skeleton when plugins are loading', () => {
            mockUsePluginAdmin.mockReturnValue({
                ...defaultPluginAdmin,
                plugins: { isLoading: true, isError: false, data: [] },
            });

            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByText(/loading available plugins/i)).toBeInTheDocument();
        });
    });

    describe('Error state', () => {
        it('shows error message when plugin load fails', () => {
            mockUsePluginAdmin.mockReturnValue({
                ...defaultPluginAdmin,
                plugins: { isLoading: false, isError: true, data: [] },
            });

            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByText(/failed to load plugins/i)).toBeInTheDocument();
        });

        it('shows Back and Skip buttons in error state', () => {
            mockUsePluginAdmin.mockReturnValue({
                ...defaultPluginAdmin,
                plugins: { isLoading: false, isError: true, data: [] },
            });

            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
        });

        it('Back button in error state has min-h-[44px]', () => {
            mockUsePluginAdmin.mockReturnValue({
                ...defaultPluginAdmin,
                plugins: { isLoading: false, isError: true, data: [] },
            });

            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByRole('button', { name: /back/i }).className).toContain('min-h-[44px]');
        });

        it('Skip button in error state has min-h-[44px]', () => {
            mockUsePluginAdmin.mockReturnValue({
                ...defaultPluginAdmin,
                plugins: { isLoading: false, isError: true, data: [] },
            });

            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByRole('button', { name: /skip/i }).className).toContain('min-h-[44px]');
        });
    });

    describe('Stub plugin (no real plugins)', () => {
        it('shows stub plugin when no real plugins are registered', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByText(/core community features/i)).toBeInTheDocument();
        });

        it('stub plugin Install button has min-h-[44px]', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            const installBtn = screen.getByRole('button', { name: /install/i });
            expect(installBtn.className).toContain('min-h-[44px]');
        });

        it('stub plugin can be installed (local toggle, no API call)', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            fireEvent.click(screen.getByRole('button', { name: /install/i }));
            // After install, stub shows as active (no Install button anymore)
            expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
        });
    });

    describe('Real plugins', () => {
        it('renders real plugins when available', () => {
            mockUsePluginAdmin.mockReturnValue({
                ...defaultPluginAdmin,
                plugins: {
                    isLoading: false,
                    isError: false,
                    data: [
                        {
                            slug: 'blizzard',
                            name: 'Blizzard Plugin',
                            version: '1.0.0',
                            description: 'WoW integration',
                            author: { name: 'Raid Ledger' },
                            gameSlugs: ['wow'],
                            capabilities: ['character-sync'],
                            integrations: [],
                            status: 'not_installed',
                            installedAt: null,
                        },
                    ],
                },
            });

            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByText('Blizzard Plugin')).toBeInTheDocument();
        });

        it('shows Activate button for inactive plugins', () => {
            mockUsePluginAdmin.mockReturnValue({
                ...defaultPluginAdmin,
                plugins: {
                    isLoading: false,
                    isError: false,
                    data: [
                        {
                            slug: 'blizzard',
                            name: 'Blizzard Plugin',
                            version: '1.0.0',
                            description: 'WoW integration',
                            author: { name: 'Raid Ledger' },
                            gameSlugs: [],
                            capabilities: [],
                            integrations: [],
                            status: 'inactive',
                            installedAt: new Date().toISOString(),
                        },
                    ],
                },
            });

            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            const activateBtn = screen.getByRole('button', { name: /activate/i });
            expect(activateBtn).toBeInTheDocument();
            expect(activateBtn.className).toContain('min-h-[44px]');
        });
    });

    describe('Plugin card responsive layout (flex-col sm:flex-row)', () => {
        it('plugin card header uses flex-col on mobile and sm:flex-row on desktop', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            // The plugin card div with responsive flex layout
            const { container } = renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );
            const pluginCardFlexDiv = container.querySelector('.flex.flex-col.sm\\:flex-row');
            expect(pluginCardFlexDiv).not.toBeNull();
        });
    });

    describe('Navigation buttons', () => {
        it('Back button calls onBack', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            fireEvent.click(screen.getByRole('button', { name: /back/i }));
            expect(mockOnBack).toHaveBeenCalledOnce();
        });

        it('Skip button calls onSkip', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            fireEvent.click(screen.getByRole('button', { name: /skip/i }));
            expect(mockOnSkip).toHaveBeenCalledOnce();
        });

        it('Next button calls onNext', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            expect(mockOnNext).toHaveBeenCalledOnce();
        });

        it('Back button has min-h-[44px]', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByRole('button', { name: /back/i }).className).toContain('min-h-[44px]');
        });

        it('Next button has min-h-[44px]', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByRole('button', { name: /next/i }).className).toContain('min-h-[44px]');
        });

        it('Skip button has min-h-[44px]', () => {
            renderWithProviders(
                <ConnectPluginsStep onNext={mockOnNext} onBack={mockOnBack} onSkip={mockOnSkip} />
            );

            expect(screen.getByRole('button', { name: /skip/i }).className).toContain('min-h-[44px]');
        });
    });
});
