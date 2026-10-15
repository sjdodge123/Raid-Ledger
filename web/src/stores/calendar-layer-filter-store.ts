/**
 * ROK-1775 — which plugin calendar layers the viewer has switched off in the
 * calendar's Filters panel. Stored as the layer keys that are HIDDEN, so every
 * layer — including one registered after the preference was saved — defaults
 * to ON. Persisted with the other calendar filter preferences
 * (`PATCH /users/me/preferences`, key `calendarHiddenLayers`) and loaded by
 * `useThemeSync` on login.
 */
import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';

export const CALENDAR_HIDDEN_LAYERS_PREF = 'calendarHiddenLayers';

interface CalendarLayerFilterState {
    /** Layer keys the viewer has hidden. Empty = every layer shown (the default). */
    hiddenLayers: ReadonlySet<string>;
    /** Flip one layer and persist the new hidden list. */
    toggleLayer: (key: string) => void;
    /** Show every layer again ("Clear all") and persist. */
    showAllLayers: () => void;
    /** Apply the saved preference — does not write it back. */
    loadHiddenLayers: (keys: readonly string[]) => void;
    /** Reset to the default (for tests). */
    _reset: () => void;
}

const NONE_HIDDEN: ReadonlySet<string> = new Set<string>();

/** Fire-and-forget, like the calendar game filter: offline/unauth fails silently. */
function persistHiddenLayers(hidden: ReadonlySet<string>): void {
    if (!getAuthToken()) return;
    updatePreference(CALENDAR_HIDDEN_LAYERS_PREF, [...hidden]).catch(() => {
        // Silent — the in-memory toggle still applies for this session.
    });
}

function toggled(hidden: ReadonlySet<string>, key: string): ReadonlySet<string> {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
}

export const useCalendarLayerFilterStore = create<CalendarLayerFilterState>((set, get) => ({
    hiddenLayers: NONE_HIDDEN,
    toggleLayer(key) {
        const next = toggled(get().hiddenLayers, key);
        set({ hiddenLayers: next });
        persistHiddenLayers(next);
    },
    showAllLayers() {
        if (get().hiddenLayers.size === 0) return;
        set({ hiddenLayers: NONE_HIDDEN });
        persistHiddenLayers(NONE_HIDDEN);
    },
    loadHiddenLayers(keys) {
        set({ hiddenLayers: keys.length > 0 ? new Set(keys) : NONE_HIDDEN });
    },
    _reset() { set({ hiddenLayers: NONE_HIDDEN }); },
}));
