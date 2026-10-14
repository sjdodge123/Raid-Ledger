/**
 * Plugin calendar layers (ROK-1774) — the generic host API a plugin uses to
 * draw non-event time spans ("windows") and points ("markers") on the
 * calendar. Plugins register through `PluginHandle.registerCalendarLayer`;
 * core reads merged items through `useCalendarLayers`, which only ever
 * returns items from ACTIVE plugins. Core never imports a plugin's code —
 * `web/src/test/pelican-core-boundary.guard.test.ts` enforces that.
 */
import { usePluginStore } from '../stores/plugin-store';
import { getCalendarLayerRegistrations } from './plugin-registry';

/** ISO 8601 with offset — exactly what computeDateRange yields. */
export interface CalendarLayerRange {
    from: string;
    to: string;
}

/** A tooltip/aria pair, already formatted by the plugin in the viewer's timezone. */
export interface CalendarLayerTip {
    title: string;
    detail: string;
}

export interface CalendarLayerWindow {
    kind: 'window';
    /** Stable within the layer, e.g. `${serverKey}:${start}`. */
    id: string;
    /** ISO with offset. */
    start: string;
    end: string;
    /** e.g. "Server up · Valheim Dedicated". */
    label: string;
    /** Full sentence incl. local times. */
    ariaLabel: string;
}

export interface CalendarLayerMarker {
    kind: 'marker';
    id: string;
    /** ISO with offset. */
    at: string;
    /** Only glyph in v1; the union widens later. */
    glyph: 'power';
    tip: CalendarLayerTip;
}

export type CalendarLayerItem = CalendarLayerWindow | CalendarLayerMarker;

export interface CalendarLayer {
    /** Unique across plugins, e.g. 'pelican:server-schedule'. Re-registering a key replaces it (HMR). */
    key: string;
    /**
     * A React hook. Called EVERY render for EVERY registered layer, in registration order
     * (stable hook order); `enabled=false` when the plugin is inactive or the view is not
     * week/day — the layer must then disable its queries and may return [].
     */
    useItems(
        range: CalendarLayerRange,
        selectedGames: ReadonlySet<string> | undefined,
        enabled: boolean,
    ): readonly CalendarLayerItem[];
}

export interface CalendarLayerRegistration {
    pluginSlug: string;
    layer: CalendarLayer;
}

/** Shared empty result, so "nothing to draw" keeps one identity across renders. */
const NO_ITEMS: readonly CalendarLayerItem[] = Object.freeze([]);

/**
 * Merged items of ACTIVE plugins' layers only, in registration order.
 *
 * Every registered layer's `useItems` runs on every render (rules of hooks);
 * an inactive plugin's layer — or every layer when `viewEnabled` is false —
 * is called with `enabled=false` and its items are discarded. Returns a new
 * array whenever any layer has items; the empty result is a stable constant.
 */
export function useCalendarLayers(
    range: CalendarLayerRange,
    selectedGames: ReadonlySet<string> | undefined,
    viewEnabled: boolean,
): readonly CalendarLayerItem[] {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const merged: CalendarLayerItem[] = [];
    for (const { pluginSlug, layer } of getCalendarLayerRegistrations()) {
        const enabled = viewEnabled && activeSlugs.has(pluginSlug);
        const items = layer.useItems(range, selectedGames, enabled);
        if (enabled) merged.push(...items);
    }
    return merged.length > 0 ? merged : NO_ITEMS;
}
