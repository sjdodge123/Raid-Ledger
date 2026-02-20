import { describe, it, expect, beforeEach } from 'vitest';
import { registerSlotComponent, getSlotRegistrations, clearRegistry, registerPlugin, getPluginBadge } from './plugin-registry';

function StubComponent() { return null; }
function StubComponent2() { return null; }

describe('plugin-registry', () => {
    beforeEach(() => {
        clearRegistry();
    });

    it('registers a component and retrieves it by slot name', () => {
        registerSlotComponent({
            pluginSlug: 'test-plugin',
            slotName: 'character-detail:sections',
            component: StubComponent,
            priority: 0,
        });

        const registrations = getSlotRegistrations('character-detail:sections');
        expect(registrations).toHaveLength(1);
        expect(registrations[0].pluginSlug).toBe('test-plugin');
        expect(registrations[0].component).toBe(StubComponent);
    });

    it('returns empty array for slots with no registrations', () => {
        const registrations = getSlotRegistrations('admin-settings:integration-cards');
        expect(registrations).toHaveLength(0);
    });

    it('filters registrations by slot name', () => {
        registerSlotComponent({
            pluginSlug: 'test-plugin',
            slotName: 'character-detail:sections',
            component: StubComponent,
            priority: 0,
        });
        registerSlotComponent({
            pluginSlug: 'test-plugin',
            slotName: 'event-create:content-browser',
            component: StubComponent2,
            priority: 0,
        });

        expect(getSlotRegistrations('character-detail:sections')).toHaveLength(1);
        expect(getSlotRegistrations('event-create:content-browser')).toHaveLength(1);
    });

    it('sorts registrations by priority (ascending)', () => {
        registerSlotComponent({
            pluginSlug: 'plugin-b',
            slotName: 'character-detail:sections',
            component: StubComponent2,
            priority: 10,
        });
        registerSlotComponent({
            pluginSlug: 'plugin-a',
            slotName: 'character-detail:sections',
            component: StubComponent,
            priority: 0,
        });

        const registrations = getSlotRegistrations('character-detail:sections');
        expect(registrations).toHaveLength(2);
        expect(registrations[0].pluginSlug).toBe('plugin-a');
        expect(registrations[1].pluginSlug).toBe('plugin-b');
    });

    it('clearRegistry removes all registrations', () => {
        registerSlotComponent({
            pluginSlug: 'test-plugin',
            slotName: 'character-detail:sections',
            component: StubComponent,
            priority: 0,
        });

        expect(getSlotRegistrations('character-detail:sections')).toHaveLength(1);

        clearRegistry();

        expect(getSlotRegistrations('character-detail:sections')).toHaveLength(0);
    });

    it('supports multiple plugins registering the same slot', () => {
        registerSlotComponent({
            pluginSlug: 'plugin-a',
            slotName: 'character-detail:header-badges',
            component: StubComponent,
            priority: 0,
        });
        registerSlotComponent({
            pluginSlug: 'plugin-b',
            slotName: 'character-detail:header-badges',
            component: StubComponent2,
            priority: 5,
        });

        const registrations = getSlotRegistrations('character-detail:header-badges');
        expect(registrations).toHaveLength(2);
        expect(registrations[0].pluginSlug).toBe('plugin-a');
        expect(registrations[1].pluginSlug).toBe('plugin-b');
    });

    it('registerPlugin stores badge metadata', () => {
        registerPlugin('my-plugin', { icon: 'X', color: 'blue', label: 'My Plugin' });
        const badge = getPluginBadge('my-plugin');
        expect(badge).toEqual({ icon: 'X', color: 'blue', label: 'My Plugin' });
    });

    it('getPluginBadge returns undefined for unregistered plugin', () => {
        expect(getPluginBadge('nonexistent')).toBeUndefined();
    });

    it('clearRegistry also clears badge metadata', () => {
        registerPlugin('test', { icon: 'T', color: 'red', label: 'Test' });
        expect(getPluginBadge('test')).toBeDefined();

        clearRegistry();

        expect(getPluginBadge('test')).toBeUndefined();
    });

    it('registerPlugin overwrites badge for same slug (HMR safe)', () => {
        registerPlugin('plug', { icon: 'A', color: 'blue', label: 'First' });
        registerPlugin('plug', { icon: 'B', color: 'red', label: 'Second' });

        const badge = getPluginBadge('plug');
        expect(badge).toEqual({ icon: 'B', color: 'red', label: 'Second' });
    });
});
