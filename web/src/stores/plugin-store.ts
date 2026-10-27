import { create } from 'zustand';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';

/**
 * ROK-1969 D3 — whether `slug` is active in `active`. The built-in Core plugin is
 * always on, even before the api's list arrives, so nothing core waits on hydration.
 */
export function isSlugActive(active: ReadonlySet<string>, slug: string): boolean {
    return slug === CORE_PLUGIN_ID || active.has(slug);
}

interface PluginState {
    /** Active plugin slugs; always includes the built-in `core` (ROK-1969 D3). */
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
    activeSlugs: new Set<string>([CORE_PLUGIN_ID]),
    initialized: false,
    settled: false,

    setActiveSlugs(slugs: string[]) {
        set({ activeSlugs: new Set([CORE_PLUGIN_ID, ...slugs]), initialized: true, settled: true });
    },

    markSettled() {
        if (!get().settled) set({ settled: true });
    },

    isPluginActive(slug: string) {
        return isSlugActive(get().activeSlugs, slug);
    },
}));
