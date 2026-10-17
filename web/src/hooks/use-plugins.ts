import { useEffect } from 'react';
import { useSystemStatus } from './use-system-status';
import { usePluginStore } from '../stores/plugin-store';

/**
 * Hydrates the plugin store from system status.
 * Call once in the Layout component.
 */
export function usePluginHydration(): void {
    const { data } = useSystemStatus();
    const setActiveSlugs = usePluginStore((s) => s.setActiveSlugs);

    useEffect(() => {
        if (data?.activePlugins) {
            setActiveSlugs(data.activePlugins);
        }
    }, [data?.activePlugins, setActiveSlugs]);
}

/**
 * Has the active-plugin list settled? (ROK-1830)
 *
 * `usePluginHydration` fills the store from an async query in an effect, so
 * there is a window where the app has rendered but every plugin still reads as
 * inactive. A page whose first render depends on which plugins are on — the
 * hub, whose tab set comes from the module registered for the guild's kind —
 * holds its loading state until this is `true`, instead of rendering once
 * without the module and again with it.
 *
 * A failed status request, and a response that carries no `activePlugins`,
 * both settle as "no plugins": `usePluginHydration` has nothing to apply, so
 * waiting for `initialized` would wait forever.
 *
 * Those two outcomes are read off a live query, so they can be withdrawn —
 * a new observer on a warm navigation re-triggers the failed query and it is
 * pending again. The answer is therefore latched in the store (`settled`,
 * one-way): once ANY outcome has settled, a later remount or retry can no
 * longer send a page that has already rendered back to `<LoadingState/>`.
 * That also covers the offline case, where the query is paused and never
 * settles at all — the first settled outcome is the last word.
 */
export function usePluginsHydrated(): boolean {
    const initialized = usePluginStore((s) => s.initialized);
    const settled = usePluginStore((s) => s.settled);
    const markSettled = usePluginStore((s) => s.markSettled);
    const { data, isError } = useSystemStatus();
    const hydrated =
        settled || initialized || isError || (data !== undefined && !Array.isArray(data.activePlugins));

    useEffect(() => {
        if (hydrated) markSettled();
    }, [hydrated, markSettled]);

    return hydrated;
}
