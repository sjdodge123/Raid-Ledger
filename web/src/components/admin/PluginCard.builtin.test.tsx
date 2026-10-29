/**
 * ROK-1969 review MAJOR 3 — a built-in plugin (Core) cannot be deactivated or
 * uninstalled (the api answers 400), so neither admin plugin card offers it.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { emptyPluginHubManifest, type PluginInfoDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { PluginCard as LegacyPluginCard } from './PluginCard';
import { PluginCard as AdminPluginCard } from '../../pages/admin/plugins/PluginCard';

const core: PluginInfoDto = {
    slug: 'core', name: 'Core', version: '1.0.0', description: 'Built in.', author: { name: 'Raid Ledger' },
    builtIn: true, hub: emptyPluginHubManifest(), gameSlugs: [], capabilities: [], integrations: [],
    status: 'active', installedAt: null,
};
const handlers = { onInstall: vi.fn(), onUninstall: vi.fn(), onActivate: vi.fn(), onDeactivate: vi.fn() };
const CARDS = [['components/admin', LegacyPluginCard], ['pages/admin/plugins', AdminPluginCard]] as const;

describe.each(CARDS)('%s PluginCard — built-in plugin', (_name, Card) => {
    it.each(['active', 'inactive', 'not_installed'] as const)('offers no lifecycle button when %s', (status) => {
        renderWithProviders(<Card plugin={{ ...core, status }} {...handlers} isPending={false} />);
        for (const label of ['Install', 'Activate', 'Deactivate', 'Uninstall']) {
            expect(screen.queryByRole('button', { name: label })).toBeNull();
        }
    });

    it('still offers Deactivate on an active non-built-in plugin', () => {
        renderWithProviders(<Card plugin={{ ...core, slug: 'valheim', builtIn: false }} {...handlers} isPending={false} />);
        expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    });
});
