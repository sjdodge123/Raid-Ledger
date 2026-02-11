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
