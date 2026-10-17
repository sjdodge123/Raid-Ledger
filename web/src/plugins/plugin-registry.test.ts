import { describe, it, expect, beforeEach } from 'vitest';
import { registerSlotComponent, getSlotRegistrations, clearRegistry, registerPlugin, getPluginBadge, getCalendarLayerRegistrations } from './plugin-registry';
import type { CalendarLayer } from './calendar-layer';

function StubComponent() { return null; }
function StubComponent2() { return null; }

describe('plugin-registry — part 1', () => {
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
        expect(registrations[0]?.pluginSlug).toBe('test-plugin');
        expect(registrations[0]?.component).toBe(StubComponent);
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
        expect(registrations[0]?.pluginSlug).toBe('plugin-a');
        expect(registrations[1]?.pluginSlug).toBe('plugin-b');
    });

});

describe('plugin-registry — part 2', () => {
    beforeEach(() => {
        clearRegistry();
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
        expect(registrations[0]?.pluginSlug).toBe('plugin-a');
        expect(registrations[1]?.pluginSlug).toBe('plugin-b');
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

describe('plugin-registry — character-create:header-actions (ROK-1738)', () => {
    beforeEach(() => clearRegistry());

    it('registers a filler for the Add Character header slot', () => {
        const Filler = () => null;
        registerPlugin('blizzard', { icon: '/b.jpg', color: 'blue', label: 'WoW' }).registerSlot('character-create:header-actions', Filler);
        expect(getSlotRegistrations('character-create:header-actions')).toEqual([
            expect.objectContaining({ pluginSlug: 'blizzard', component: Filler }),
        ]);
    });
});

describe('plugin-registry — calendar layers (ROK-1774)', () => {
    const badge = { icon: 'p', color: 'gray', label: 'P' };
    const layer = (key: string): CalendarLayer => ({ key, useItems: () => [] });

    beforeEach(() => clearRegistry());

    it('registerCalendarLayer stores the layer under the registering plugin slug', () => {
        const l = layer('pelican:server-schedule');
        registerPlugin('pelican', badge).registerCalendarLayer(l);
        expect(getCalendarLayerRegistrations()).toEqual([{ pluginSlug: 'pelican', layer: l }]);
    });

    it('re-registering the same key replaces it in place (no duplicate)', () => {
        const first = layer('x:one');
        const replacement = layer('x:one');
        const handle = registerPlugin('x', badge);
        handle.registerCalendarLayer(first);
        handle.registerCalendarLayer(layer('x:two'));
        handle.registerCalendarLayer(replacement);
        const regs = getCalendarLayerRegistrations();
        expect(regs.map((r) => r.layer.key)).toEqual(['x:one', 'x:two']);
        expect(regs[0]?.layer).toBe(replacement);
    });

    it('clearRegistry empties the calendar layers', () => {
        registerPlugin('x', badge).registerCalendarLayer(layer('x:one'));
        clearRegistry();
        expect(getCalendarLayerRegistrations()).toEqual([]);
    });
});
