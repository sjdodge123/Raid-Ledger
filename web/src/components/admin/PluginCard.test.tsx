import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PluginCard } from './PluginCard';
import type { PluginInfoDto } from '@raid-ledger/contract';

const basePlugin: PluginInfoDto = {
    slug: 'blizzard',
    name: 'Blizzard Plugin',
    version: '1.2.0',
    description: 'Adds WoW character import and realm data',
    author: { name: 'Raid Ledger Team' },
    gameSlugs: ['wow', 'wow-classic'],
    capabilities: ['character-sync', 'content-provider'],
    integrations: [
        {
            key: 'blizzard-api',
            name: 'Blizzard API',
            description: 'Battle.net OAuth',
            configured: true,
            credentialLabels: ['Client ID', 'Client Secret'],
        },
    ],
    status: 'active',
    installedAt: new Date().toISOString(),
};

const handlers = {
    onInstall: vi.fn(),
    onUninstall: vi.fn(),
    onActivate: vi.fn(),
    onDeactivate: vi.fn(),
};

describe('PluginCard', () => {
    it('renders plugin name, version and description', () => {
        render(<PluginCard plugin={basePlugin} {...handlers} isPending={false} />);

        expect(screen.getByText('Blizzard Plugin')).toBeInTheDocument();
        expect(screen.getByText('v1.2.0')).toBeInTheDocument();
        expect(screen.getByText('Adds WoW character import and realm data')).toBeInTheDocument();
    });

    it('renders author name without link when no URL', () => {
        render(<PluginCard plugin={basePlugin} {...handlers} isPending={false} />);

        expect(screen.getByText(/Raid Ledger Team/)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Raid Ledger Team/ })).not.toBeInTheDocument();
    });

    it('renders author name as link when URL provided', () => {
        const withUrl = {
            ...basePlugin,
            author: { name: 'Author', url: 'https://example.com' },
        };
        render(<PluginCard plugin={withUrl} {...handlers} isPending={false} />);

        const link = screen.getByRole('link', { name: 'Author' });
        expect(link).toHaveAttribute('href', 'https://example.com');
    });

    it('shows Active badge for active status', () => {
        render(<PluginCard plugin={basePlugin} {...handlers} isPending={false} />);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows Inactive badge for inactive status', () => {
        const inactive = { ...basePlugin, status: 'inactive' as const };
        render(<PluginCard plugin={inactive} {...handlers} isPending={false} />);
        expect(screen.getByText('Inactive')).toBeInTheDocument();
    });

    it('shows Not Installed badge for not_installed status', () => {
        const notInstalled = { ...basePlugin, status: 'not_installed' as const, installedAt: null };
        render(<PluginCard plugin={notInstalled} {...handlers} isPending={false} />);
        expect(screen.getByText('Not Installed')).toBeInTheDocument();
    });

    it('renders game slug and capability tags', () => {
        render(<PluginCard plugin={basePlugin} {...handlers} isPending={false} />);

        expect(screen.getByText('wow')).toBeInTheDocument();
        expect(screen.getByText('wow-classic')).toBeInTheDocument();
        expect(screen.getByText('character-sync')).toBeInTheDocument();
        expect(screen.getByText('content-provider')).toBeInTheDocument();
    });

    it('renders integration health dot as green when configured', () => {
        const { container } = render(
            <PluginCard plugin={basePlugin} {...handlers} isPending={false} />,
        );

        expect(screen.getByText('Blizzard API')).toBeInTheDocument();
        // Green dot present
        const dot = container.querySelector('.bg-emerald-400');
        expect(dot).toBeInTheDocument();
    });

    it('renders integration health dot as red when not configured', () => {
        const unconfigured = {
            ...basePlugin,
            integrations: [{ ...basePlugin.integrations[0], configured: false }],
        };
        const { container } = render(
            <PluginCard plugin={unconfigured} {...handlers} isPending={false} />,
        );

        const dot = container.querySelector('.bg-red-400');
        expect(dot).toBeInTheDocument();
    });

    // Action buttons by status
    it('shows Deactivate button for active plugins', () => {
        render(<PluginCard plugin={basePlugin} {...handlers} isPending={false} />);
        expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    });

    it('shows Activate and Uninstall buttons for inactive plugins', () => {
        const inactive = { ...basePlugin, status: 'inactive' as const };
        render(<PluginCard plugin={inactive} {...handlers} isPending={false} />);

        expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
    });

    it('shows Install button for not_installed plugins', () => {
        const notInstalled = { ...basePlugin, status: 'not_installed' as const, installedAt: null };
        render(<PluginCard plugin={notInstalled} {...handlers} isPending={false} />);

        expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    });

    it('calls onInstall when Install is clicked', () => {
        const notInstalled = { ...basePlugin, status: 'not_installed' as const, installedAt: null };
        render(<PluginCard plugin={notInstalled} {...handlers} isPending={false} />);

        fireEvent.click(screen.getByRole('button', { name: 'Install' }));
        expect(handlers.onInstall).toHaveBeenCalledWith('blizzard');
    });

    it('calls onDeactivate when Deactivate is clicked', () => {
        render(<PluginCard plugin={basePlugin} {...handlers} isPending={false} />);

        fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
        expect(handlers.onDeactivate).toHaveBeenCalledWith('blizzard');
    });

    it('calls onActivate when Activate is clicked', () => {
        const inactive = { ...basePlugin, status: 'inactive' as const };
        render(<PluginCard plugin={inactive} {...handlers} isPending={false} />);

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        expect(handlers.onActivate).toHaveBeenCalledWith('blizzard');
    });

    it('calls onUninstall when Uninstall is clicked', () => {
        const inactive = { ...basePlugin, status: 'inactive' as const };
        render(<PluginCard plugin={inactive} {...handlers} isPending={false} />);

        fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
        expect(handlers.onUninstall).toHaveBeenCalledWith('blizzard');
    });

    it('disables buttons when isPending is true', () => {
        render(<PluginCard plugin={basePlugin} {...handlers} isPending={true} />);

        expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
    });
});
