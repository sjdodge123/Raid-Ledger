/**
 * ROK-1775 — the show/hide checkboxes for plugin calendar layers in the
 * calendar's Filters panel. Generic: one toggle per registered layer that
 * supplies a `filterLabel` AND whose plugin is active. Core never names a
 * plugin here.
 */
import { useMemo } from 'react';
import { getCalendarLayerRegistrations } from '../../plugins/plugin-registry';
import { usePluginStore } from '../../stores/plugin-store';
import { useCalendarLayerFilterStore } from '../../stores/calendar-layer-filter-store';

export interface CalendarLayerToggle {
    key: string;
    label: string;
    description: string | undefined;
    visible: boolean;
}

export interface CalendarLayerToggles {
    toggles: readonly CalendarLayerToggle[];
    toggleLayer: (key: string) => void;
    showAllLayers: () => void;
    /** Toggles currently OFF — they count toward the Filters badge. */
    hiddenCount: number;
}

export function useCalendarLayerToggles(): CalendarLayerToggles {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const hiddenLayers = useCalendarLayerFilterStore((s) => s.hiddenLayers);
    const toggleLayer = useCalendarLayerFilterStore((s) => s.toggleLayer);
    const showAllLayers = useCalendarLayerFilterStore((s) => s.showAllLayers);
    const toggles = useMemo(() => getCalendarLayerRegistrations().flatMap(({ pluginSlug, layer }) => {
        if (!layer.filterLabel || !activeSlugs.has(pluginSlug)) return [];
        return [{
            key: layer.key, label: layer.filterLabel,
            description: layer.filterDescription, visible: !hiddenLayers.has(layer.key),
        }];
    }), [activeSlugs, hiddenLayers]);
    const hiddenCount = toggles.filter((t) => !t.visible).length;
    return { toggles, toggleLayer, showAllLayers, hiddenCount };
}
