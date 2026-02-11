import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from './plugin-store';

describe('plugin-store', () => {
    beforeEach(() => {
        // Reset store to initial state
        usePluginStore.setState({
            activeSlugs: new Set<string>(),
            initialized: false,
        });
    });

    it('starts uninitialized with empty active slugs', () => {
        const state = usePluginStore.getState();
        expect(state.initialized).toBe(false);
        expect(state.activeSlugs.size).toBe(0);
    });

    it('setActiveSlugs updates slugs and marks initialized', () => {
        usePluginStore.getState().setActiveSlugs(['blizzard', 'custom-plugin']);

        const state = usePluginStore.getState();
        expect(state.initialized).toBe(true);
        expect(state.activeSlugs.has('blizzard')).toBe(true);
        expect(state.activeSlugs.has('custom-plugin')).toBe(true);
    });

    it('isPluginActive returns true for active plugins', () => {
        usePluginStore.getState().setActiveSlugs(['blizzard']);

        expect(usePluginStore.getState().isPluginActive('blizzard')).toBe(true);
        expect(usePluginStore.getState().isPluginActive('other')).toBe(false);
    });

    it('isPluginActive returns false when no plugins are active', () => {
        expect(usePluginStore.getState().isPluginActive('blizzard')).toBe(false);
    });

    it('setActiveSlugs replaces previous slugs', () => {
        usePluginStore.getState().setActiveSlugs(['blizzard']);
        expect(usePluginStore.getState().isPluginActive('blizzard')).toBe(true);

        usePluginStore.getState().setActiveSlugs(['other-plugin']);
        expect(usePluginStore.getState().isPluginActive('blizzard')).toBe(false);
        expect(usePluginStore.getState().isPluginActive('other-plugin')).toBe(true);
    });

    it('setActiveSlugs handles empty array', () => {
        usePluginStore.getState().setActiveSlugs(['blizzard']);
        usePluginStore.getState().setActiveSlugs([]);

        const state = usePluginStore.getState();
        expect(state.initialized).toBe(true);
        expect(state.activeSlugs.size).toBe(0);
    });
});
