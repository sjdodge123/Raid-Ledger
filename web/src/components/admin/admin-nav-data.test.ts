/**
 * Unit tests for admin navigation data builder functions (ROK-359, ROK-267).
 * Tests consolidation: core items, demo data conditional, plugin integration items.
 * Discord integration is now plugin-managed (ROK-267), not a core integration.
 */
import { describe, it, expect } from 'vitest';
import {
    buildCoreIntegrationItems,
    buildPluginIntegrationItems,
    buildDiscordNavItems,
    buildNavSections,
} from './admin-nav-data';
import type { PluginInfoDto } from '@raid-ledger/contract';

const allOfflineStatuses = {
    igdb: { configured: false, loading: false },
};

describe('buildCoreIntegrationItems', () => {
    it('returns 1 item (IGDB)', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        expect(items).toHaveLength(1);
    });

    it('includes IGDB with correct path', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const igdb = items.find((i) => i.label === 'IGDB / Twitch');
        expect(igdb).toBeDefined();
        expect(igdb!.to).toBe('/admin/settings/integrations/igdb');
    });

    it('sets IGDB status to offline when not configured', () => {
        const items = buildCoreIntegrationItems(allOfflineStatuses);
        const igdb = items.find((i) => i.label === 'IGDB / Twitch');
        expect(igdb!.status).toBe('offline');
    });

    it('sets IGDB status to online when configured', () => {
        const items = buildCoreIntegrationItems({
            igdb: { configured: true, loading: false },
        });
        const igdb = items.find((i) => i.label === 'IGDB / Twitch');
        expect(igdb!.status).toBe('online');
    });

    it('sets IGDB status to loading when loading', () => {
        const items = buildCoreIntegrationItems({
            igdb: { configured: false, loading: true },
        });
        const igdb = items.find((i) => i.label === 'IGDB / Twitch');
        expect(igdb!.status).toBe('loading');
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

    it('excludes Discord plugin from integration items (ROK-430: Discord has its own section)', () => {
        const plugins: PluginInfoDto[] = [
            makePlugin({
                slug: 'discord',
                name: 'Discord Authentication',
                status: 'active',
                integrations: [{ key: 'discord-oauth', name: 'Discord', configured: true, description: '', credentialLabels: [] }],
            }),
        ];
        const items = buildPluginIntegrationItems(plugins);
        expect(items).toHaveLength(0);
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

describe('buildDiscordNavItems', () => {
    it('returns 4 items: Overview, Connection, Channels, Features', () => {
        const items = buildDiscordNavItems();
        expect(items).toHaveLength(4);
        expect(items.map((i) => i.label)).toEqual(['Overview', 'Connection', 'Channels', 'Features']);
    });

    it('Connection item shows online status when connected', () => {
        const items = buildDiscordNavItems({ connected: true, connecting: false });
        const conn = items.find((i) => i.label === 'Connection')!;
        expect(conn.status).toBe('online');
    });

    it('Connection item shows offline status when not connected', () => {
        const items = buildDiscordNavItems({ connected: false, connecting: false });
        const conn = items.find((i) => i.label === 'Connection')!;
        expect(conn.status).toBe('offline');
    });

    it('Connection item shows loading status when connecting', () => {
        const items = buildDiscordNavItems({ connected: false, connecting: true });
        const conn = items.find((i) => i.label === 'Connection')!;
        expect(conn.status).toBe('loading');
    });
});

describe('buildNavSections', () => {
    it('returns exactly 2 sections when no Discord items: General and Integrations', () => {
        const sections = buildNavSections([], []);
        expect(sections).toHaveLength(2);
        expect(sections[0].id).toBe('general');
        expect(sections[1].id).toBe('integrations');
    });

    it('returns 3 sections when Discord items provided', () => {
        const discordItems = buildDiscordNavItems();
        const sections = buildNavSections([], [], discordItems);
        expect(sections).toHaveLength(3);
        expect(sections[0].id).toBe('general');
        expect(sections[1].id).toBe('discord');
        expect(sections[2].id).toBe('integrations');
    });

    it('General section has 5 items (including Demo Data)', () => {
        const sections = buildNavSections([], []);
        const general = sections.find((s) => s.id === 'general')!;
        expect(general.children).toHaveLength(5);
    });

    it('Demo Data item is at index 2 (after Site Settings and User Management)', () => {
        const sections = buildNavSections([], []);
        const general = sections.find((s) => s.id === 'general')!;
        expect(general.children[2].label).toBe('Demo Data');
        expect(general.children[2].to).toBe('/admin/settings/general/data');
    });

    it('General section includes Site Settings, User Management, Scheduled Jobs, Backups', () => {
        const sections = buildNavSections([], []);
        const general = sections.find((s) => s.id === 'general')!;
        const labels = general.children.map((c) => c.label);
        expect(labels).toContain('Site Settings');
        expect(labels).toContain('User Management');
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
        expect(labels).toContain('IGDB / Twitch');
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

    it('General section has ≤7 core nav items', () => {
        const sections = buildNavSections(buildCoreIntegrationItems(allOfflineStatuses), []);
        const general = sections.find((s) => s.id === 'general')!;
        expect(general.children.length).toBeLessThanOrEqual(7);
        expect(general.children.length).toBe(5);
    });
});
