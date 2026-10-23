/** ROK-1918 L6 — arrange-row owner labels: core, module (by hub kind), plugin, generic. */
import { describe, it, expect, afterEach } from 'vitest';
import type { HubModule } from '../../../plugins/hub-module';
import { clearRegistry, registerPlugin } from '../../../plugins/plugin-registry';
import { CORE_OWNER, pluginOwnerLabel, widgetOwner } from './widget-owner';

const serverModule: HubModule = { kind: 'game_server', tabs: [], overviewWidgets: [], memberColumns: [], heroPills: [], memberRows: () => [] };

afterEach(() => clearRegistry());

describe('widgetOwner', () => {
    it('core and generic widgets are "Core"', () => {
        expect(widgetOwner('events', 'guild')).toBe(CORE_OWNER);
        expect(widgetOwner('generic:text', 'guild')).toBe(CORE_OWNER);
    });

    it('a plugin widget names its plugin, without a trailing "Plugin"', () => {
        registerPlugin('valheim', { icon: 'x', color: 'blue', label: 'Valheim' });
        registerPlugin('blizzard', { icon: 'x', color: 'blue', label: 'World of Warcraft Plugin' });
        expect(widgetOwner('plugin:valheim:boss-board', 'game_server')).toBe('Valheim');
        expect(widgetOwner('plugin:blizzard:ready', 'guild')).toBe('World of Warcraft');
    });

    it('a module widget names the plugin that registered this hub kind', () => {
        registerPlugin('pelican', { icon: 'x', color: 'blue', label: 'Pelican' }).registerHubModule(serverModule);
        expect(widgetOwner('module:uptime', 'game_server')).toBe('Pelican');
        expect(widgetOwner('module:members-summary', 'game_community')).toBe(CORE_OWNER);
    });

    it('an unregistered plugin slug falls back to the capitalised slug', () => {
        expect(pluginOwnerLabel('ghost')).toBe('Ghost');
    });
});
