import { create } from 'zustand';

interface PluginState {
    activeSlugs: Set<string>;
    initialized: boolean;
    /**
     * ROK-1830: has the active-plugin list ever finished hydrating? Latched
     * `false → true` and never back.
     *
     * `initialized` only covers the success path. The other two settled
     * outcomes — a failed status request, a response carrying no
     * `activePlugins` — leave the store empty, and both are derived from a
     * live query, so they can be withdrawn: a fresh observer mounting on a
     * warm navigation re-triggers a failed query, which goes back to pending
     * and would drop an already-rendered page to its loading state again. The
     * latch makes that one-way, so no page that has rendered can un-render.
     *
     * Nothing resets it: the plugin store has no reset of its own, and no
     * logout or viewer-change path clears `activeSlugs`/`initialized` either,
     * so the latch has exactly the lifetime of those two fields. A test that
     * puts the store back to "not hydrated" must clear all three.
     */
    settled: boolean;
    setActiveSlugs: (slugs: string[]) => void;
    markSettled: () => void;
    isPluginActive: (slug: string) => boolean;
}

export const usePluginStore = create<PluginState>((set, get) => ({
    activeSlugs: new Set<string>(),
    initialized: false,
    settled: false,

    setActiveSlugs(slugs: string[]) {
        set({ activeSlugs: new Set(slugs), initialized: true, settled: true });
    },

    markSettled() {
        if (!get().settled) set({ settled: true });
    },

    isPluginActive(slug: string) {
        return get().activeSlugs.has(slug);
    },
}));
