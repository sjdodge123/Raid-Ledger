/**
 * ROK-1830 S4 — the one thing the Overview needs to know about the settings
 * sheet: how to open the Discord channel picker, which now lives behind the
 * sheet (Leader + admin only, D10/Q4). A context rather than four prop hops
 * through `TabPanel` → `ActiveTab` → `HubOverview`; `null` means this viewer
 * may not change the channel, so the mirror renders no affordance at all.
 * ROK-1170: also how to open the settings sheet itself (a module's hero
 * banner action); `null` when this viewer has no settings entry.
 */
import { createContext, useContext } from 'react';

export interface HubSettingsValue {
    /** Opens the channel picker, or `null` when the viewer may not pick one. */
    openChannelPicker: (() => void) | null;
    /** Opens the hub settings sheet (at the top), or `null` when the viewer may not open it. */
    openSettings: (() => void) | null;
}

const HubSettingsContext = createContext<HubSettingsValue>({ openChannelPicker: null, openSettings: null });

export const HubSettingsProvider = HubSettingsContext.Provider;

export function useHubSettings(): HubSettingsValue {
    return useContext(HubSettingsContext);
}
