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
 */
export function usePluginsHydrated(): boolean {
    const initialized = usePluginStore((s) => s.initialized);
    const { data, isError } = useSystemStatus();
    return initialized || isError || (data !== undefined && !Array.isArray(data.activePlugins));
}
