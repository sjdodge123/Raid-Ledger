/**
 * Unit tests for admin navigation data builder functions (ROK-359).
 * Tests consolidation: ≤7 core items, demo data conditional, plugin integration items.
 */
import { describe, it, expect } from 'vitest';
import {
    buildCoreIntegrationItems,
    buildPluginIntegrationItems,
    buildNavSections,
} from './admin-nav-data';
import type { PluginInfoDto } from '@raid-ledger/contract';

const allOfflineStatuses = {
    discord: { configured: false, loading: false },
    discordBot: { connected: false, configured: false, loading: false },
    igdb: { configured: false, loading: false },
};

describe('buildCoreIntegrationItems', () => {
    it('returns 4 items (Discord OAuth, Discord Bot, IGDB, Channel Bindings)', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        expect(items).toHaveLength(4);
    });

    it('includes Discord OAuth with correct path', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const discord = items.find((i) => i.label === 'Discord OAuth');
        expect(discord).toBeDefined();
        expect(discord!.to).toBe('/admin/settings/integrations');
    });

    it('includes Discord Bot with correct path', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const bot = items.find((i) => i.label === 'Discord Bot');
        expect(bot).toBeDefined();
        expect(bot!.to).toBe('/admin/settings/integrations/discord-bot');
    });

    it('includes IGDB with correct path', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const igdb = items.find((i) => i.label === 'IGDB / Twitch');
        expect(igdb).toBeDefined();
        expect(igdb!.to).toBe('/admin/settings/integrations/igdb');
    });

    it('includes Channel Bindings with correct path', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const bindings = items.find((i) => i.label === 'Channel Bindings');
        expect(bindings).toBeDefined();
        expect(bindings!.to).toBe('/admin/settings/integrations/channel-bindings');
    });

    it('sets Discord OAuth status to offline when not configured', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const discord = items.find((i) => i.label === 'Discord OAuth');
        expect(discord!.status).toBe('offline');
    });

    it('sets Discord OAuth status to online when configured', () => {
        const items = buildCoreIntegrationItems({
            ...allOfflineStatuses,
            discord: { configured: true, loading: false },
        });
        const discord = items.find((i) => i.label === 'Discord OAuth');
        expect(discord!.status).toBe('online');
    });

    it('sets Discord OAuth status to loading when loading', () => {
        const items = buildCoreIntegrationItems({
            ...allOfflineStatuses,
            discord: { configured: true, loading: true },
        });
        const discord = items.find((i) => i.label === 'Discord OAuth');
        expect(discord!.status).toBe('loading');
    });

    it('sets Discord Bot status to online when connected', () => {
        const items = buildCoreIntegrationItems({
            ...allOfflineStatuses,
            discordBot: { connected: true, configured: true, loading: false },
        });
        const bot = items.find((i) => i.label === 'Discord Bot');
        expect(bot!.status).toBe('online');
    });

    it('sets IGDB status to offline when not configured', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const igdb = items.find((i) => i.label === 'IGDB / Twitch');
        expect(igdb!.status).toBe('offline');
    });

    it('Channel Bindings has no status field', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const bindings = items.find((i) => i.label === 'Channel Bindings');
        expect(bindings!.status).toBeUndefined();
    });
});

function makePlugin(overrides: Partial<PluginInfoDto> & { slug: string; name: string; status: PluginInfoDto['status'] }): PluginInfoDto {
    return {
        version: '1.0.0',
        description: 'Test plugin',
        author: { name: 'Test Author' },
        gameSlugs: [],
        capabilities: [],
        integrations: [],
        installedAt: null,
        ...overrides,
    };
}

describe('buildPluginIntegrationItems', () => {
    it('returns empty array for empty plugin list', () => {
        expect(buildPluginIntegrationItems([])).toHaveLength(0);
    });

    it('skips plugins that are not active', () => {
        const plugins: PluginInfoDto[] = [
            makePlugin({
                slug: 'wow',
                name: 'World of Warcraft',
                status: 'inactive',
                integrations: [{ key: 'bnet', name: 'Battle.net', configured: false, description: '', credentialLabels: [] }],
            }),
        ];
        expect(buildPluginIntegrationItems(plugins)).toHaveLength(0);
    });

    it('returns items for active plugin integrations', () => {
        const plugins: PluginInfoDto[] = [
            makePlugin({
                slug: 'wow',
                name: 'World of Warcraft',
                status: 'active',
                integrations: [{ key: 'bnet', name: 'Battle.net', configured: true, description: '', credentialLabels: [] }],
            }),
        ];
        const items = buildPluginIntegrationItems(plugins);
        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('Battle.net');
        expect(items[0].to).toBe('/admin/settings/integrations/plugin/wow/bnet');
        expect(items[0].status).toBe('online');
        expect(items[0].pluginSource).toBe('World of Warcraft');
        expect(items[0].pluginSlug).toBe('wow');
    });

    it('sets newBadgeKey for plugin integration items', () => {
        const plugins: PluginInfoDto[] = [
            makePlugin({
                slug: 'wow',
                name: 'World of Warcraft',
                status: 'active',
                integrations: [{ key: 'bnet', name: 'Battle.net', configured: false, description: '', credentialLabels: [] }],
            }),
        ];
        const items = buildPluginIntegrationItems(plugins);
        expect(items[0].newBadgeKey).toBe('integration-nav-seen:wow:bnet');
    });

    it('returns offline status for unconfigured plugin integration', () => {
        const plugins: PluginInfoDto[] = [
            makePlugin({
                slug: 'wow',
                name: 'World of Warcraft',
                status: 'active',
                integrations: [{ key: 'bnet', name: 'Battle.net', configured: false, description: '', credentialLabels: [] }],
            }),
        ];
        const items = buildPluginIntegrationItems(plugins);
        expect(items[0].status).toBe('offline');
    });

    it('handles plugin with multiple integrations', () => {
        const plugins: PluginInfoDto[] = [
            makePlugin({
                slug: 'wow',
                name: 'World of Warcraft',
                status: 'active',
                integrations: [
                    { key: 'bnet', name: 'Battle.net', configured: true, description: '', credentialLabels: [] },
                    { key: 'raiderio', name: 'Raider.IO', configured: false, description: '', credentialLabels: [] },
                ],
            }),
        ];
        const items = buildPluginIntegrationItems(plugins);
        expect(items).toHaveLength(2);
    });
});

describe('buildNavSections', () => {
    it('returns exactly 2 sections: General and Integrations', () => {
        const sections = buildNavSections([], []);
        expect(sections).toHaveLength(2);
        expect(sections[0].id).toBe('general');
        expect(sections[1].id).toBe('integrations');
    });

    it('General section has 4 items when demoMode is false', () => {
        const sections = buildNavSections([], [], { demoMode: false });
        const general = sections.find((s) => s.id === 'general')!;
        expect(general.children).toHaveLength(4);
    });

    it('General section has 5 items when demoMode is true (Demo Data included)', () => {
        const sections = buildNavSections([], [], { demoMode: true });
        const general = sections.find((s) => s.id === 'general')!;
        expect(general.children).toHaveLength(5);
    });

    it('Demo Data item is at index 2 when demoMode is true (after Site Settings and Role Management)', () => {
        const sections = buildNavSections([], [], { demoMode: true });
        const general = sections.find((s) => s.id === 'general')!;
        expect(general.children[2].label).toBe('Demo Data');
        expect(general.children[2].to).toBe('/admin/settings/general/data');
    });

    it('Demo Data item is absent when demoMode is false', () => {
        const sections = buildNavSections([], [], { demoMode: false });
        const general = sections.find((s) => s.id === 'general')!;
        const demoData = general.children.find((c) => c.label === 'Demo Data');
        expect(demoData).toBeUndefined();
    });

    it('Demo Data item is absent when options not provided', () => {
        const sections = buildNavSections([], []);
        const general = sections.find((s) => s.id === 'general')!;
        const demoData = general.children.find((c) => c.label === 'Demo Data');
        expect(demoData).toBeUndefined();
    });

    it('General section includes Site Settings, Role Management, Scheduled Jobs, Backups', () => {
        const sections = buildNavSections([], []);
        const general = sections.find((s) => s.id === 'general')!;
        const labels = general.children.map((c) => c.label);
        expect(labels).toContain('Site Settings');
        expect(labels).toContain('Role Management');
        expect(labels).toContain('Scheduled Jobs');
        expect(labels).toContain('Backups');
    });

    it('Integrations section includes Manage Plugins at the end', () => {
        const sections = buildNavSections([], []);
        const integrations = sections.find((s) => s.id === 'integrations')!;
        const last = integrations.children[integrations.children.length - 1];
        expect(last.label).toBe('Manage Plugins');
        expect(last.to).toBe('/admin/settings/plugins');
    });

    it('Integrations section includes provided core integration items', () => {
        const coreItems = buildCoreIntegrationItems(allOfflineStatuses);
        const sections = buildNavSections(coreItems, []);
        const integrations = sections.find((s) => s.id === 'integrations')!;
        const labels = integrations.children.map((c) => c.label);
        expect(labels).toContain('Discord OAuth');
        expect(labels).toContain('Discord Bot');
        expect(labels).toContain('IGDB / Twitch');
        expect(labels).toContain('Channel Bindings');
    });

    it('Integrations section includes plugin items before Manage Plugins', () => {
        const plugins: PluginInfoDto[] = [
            makePlugin({
                slug: 'wow',
                name: 'World of Warcraft',
                status: 'active',
                integrations: [{ key: 'bnet', name: 'Battle.net', configured: true, description: '', credentialLabels: [] }],
            }),
        ];
        const pluginItems = buildPluginIntegrationItems(plugins);
        const sections = buildNavSections([], pluginItems);
        const integrations = sections.find((s) => s.id === 'integrations')!;
        const labels = integrations.children.map((c) => c.label);
        const bnetIdx = labels.indexOf('Battle.net');
        const pluginsIdx = labels.indexOf('Manage Plugins');
        expect(bnetIdx).toBeGreaterThanOrEqual(0);
        expect(bnetIdx).toBeLessThan(pluginsIdx);
    });

    it('General section has ≤7 core nav items (excluding dynamic plugins and demo)', () => {
        // Core = General (4 without demoMode) + core integrations (4) + Manage Plugins (1) = 9 total
        // General section alone should have exactly 4 items without demoMode
        const sections = buildNavSections(buildCoreIntegrationItems(allOfflineStatuses), [], { demoMode: false });
        const general = sections.find((s) => s.id === 'general')!;
        // General section: Site Settings, Role Management, Scheduled Jobs, Backups = 4 items ≤ 7
        expect(general.children.length).toBeLessThanOrEqual(7);
        expect(general.children.length).toBe(4);
    });
});
