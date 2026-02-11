import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PluginList } from './PluginList';
import type { PluginInfoDto } from '@raid-ledger/contract';

// Mock the hook
const mockPluginsData: PluginInfoDto[] = [];
const mockInstall = { mutateAsync: vi.fn(), isPending: false };
const mockUninstall = { mutateAsync: vi.fn(), isPending: false };
const mockActivate = { mutateAsync: vi.fn(), isPending: false };
const mockDeactivate = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../hooks/use-plugin-admin', () => ({
    usePluginAdmin: () => ({
        plugins: {
            data: mockPluginsData,
            isLoading: false,
            isSuccess: true,
        },
        install: mockInstall,
        uninstall: mockUninstall,
        activate: mockActivate,
        deactivate: mockDeactivate,
    }),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
});

function renderPluginList() {
    return render(
        <QueryClientProvider client={queryClient}>
            <PluginList />
        </QueryClientProvider>,
    );
}

const samplePlugin: PluginInfoDto = {
    slug: 'blizzard',
    name: 'Blizzard Plugin',
    version: '1.0.0',
    description: 'WoW integration',
    author: { name: 'Team' },
    gameSlugs: ['wow'],
    capabilities: ['character-sync'],
    integrations: [
        {
            key: 'blizzard-api',
            name: 'Blizzard API',
            description: 'desc',
            configured: true,
            credentialLabels: ['Client ID'],
        },
    ],
    status: 'active',
    installedAt: new Date().toISOString(),
};

describe('PluginList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPluginsData.length = 0;
    });

    it('renders empty state when no plugins', () => {
        renderPluginList();
        expect(screen.getByText('No plugins registered.')).toBeInTheDocument();
    });

    it('renders plugin cards when data is present', () => {
        mockPluginsData.push(samplePlugin);
        renderPluginList();
        expect(screen.getByText('Blizzard Plugin')).toBeInTheDocument();
    });

    it('opens uninstall modal when Uninstall is clicked on inactive plugin', () => {
        mockPluginsData.push({ ...samplePlugin, status: 'inactive' });
        renderPluginList();

        fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
        expect(screen.getByText('Uninstall Plugin')).toBeInTheDocument();
        expect(screen.getByText(/permanently delete/)).toBeInTheDocument();
    });

    it('shows configured integrations warning in uninstall modal', () => {
        mockPluginsData.push({ ...samplePlugin, status: 'inactive' });
        renderPluginList();

        fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
        expect(
            screen.getByText('Configured integrations that will lose credentials:'),
        ).toBeInTheDocument();
        // "Blizzard API" appears both in card and modal — verify modal content via the warning list
        const modal = document.querySelector('[role="dialog"]');
        expect(modal?.textContent).toContain('Blizzard API');
    });

    it('closes uninstall modal on Cancel', () => {
        mockPluginsData.push({ ...samplePlugin, status: 'inactive' });
        renderPluginList();

        fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
        expect(screen.getByText('Uninstall Plugin')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText('Uninstall Plugin')).not.toBeInTheDocument();
    });

    it('calls uninstall mutation on confirm', async () => {
        mockUninstall.mutateAsync.mockResolvedValue(undefined);
        mockPluginsData.push({ ...samplePlugin, status: 'inactive' });
        renderPluginList();

        fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));

        // Find the confirm Uninstall button inside the modal (not the card one)
        const modalButtons = screen.getAllByRole('button', { name: /Uninstall/ });
        const confirmBtn = modalButtons.find(
            (b) => b.textContent === 'Uninstall' && b.closest('[role="dialog"]'),
        );
        expect(confirmBtn).toBeDefined();

        fireEvent.click(confirmBtn!);

        expect(mockUninstall.mutateAsync).toHaveBeenCalledWith('blizzard');
    });
});
