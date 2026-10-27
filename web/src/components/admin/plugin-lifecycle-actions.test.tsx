import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { emptyPluginHubManifest, type PluginInfoDto } from '@raid-ledger/contract';
import { PluginLifecycleActions } from './plugin-lifecycle-actions';

const plugin: PluginInfoDto = {
    slug: 'blizzard', name: 'Blizzard Plugin', version: '1.2.0', description: 'd',
    author: { name: 'Author' }, builtIn: false, hub: emptyPluginHubManifest(),
    gameSlugs: [], capabilities: [], integrations: [], status: 'active', installedAt: null,
};
const handlers = { onInstall: vi.fn(), onUninstall: vi.fn(), onActivate: vi.fn(), onDeactivate: vi.fn() };

function renderActions(status: PluginInfoDto['status'], builtIn = false): void {
    render(<PluginLifecycleActions plugin={{ ...plugin, status, builtIn }} {...handlers} isPending={false} />);
}

/** ROK-1969 verify step 2 — lifecycle buttons are the design-system Button: 44px, token tints. */
describe('PluginLifecycleActions', () => {
    it.each([
        ['not_installed', 'Install', 'bg-emerald-600'],
        ['active', 'Deactivate', 'bg-warning/10'],
        ['inactive', 'Activate', 'bg-emerald-600'],
        ['inactive', 'Uninstall', 'bg-danger/10'],
    ] as const)('%s → %s is a 44px Button with the %s fill', (status, name, fill) => {
        renderActions(status);
        const button = screen.getByRole('button', { name });
        expect(button).toHaveClass('min-h-[44px]', fill);
        expect(button).toHaveAttribute('type', 'button');
        expect(button.className).not.toMatch(/amber-|emerald-800/);
    });

    it('renders nothing for a built-in plugin', () => {
        renderActions('active', true);
        expect(screen.queryByRole('button')).toBeNull();
    });
});
