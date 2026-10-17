/**
 * ROK-1830 S4 — the one thing the Overview needs to know about the settings
 * sheet: how to open the Discord channel picker, which now lives behind the
 * sheet (Leader + admin only, D10/Q4). A context rather than four prop hops
 * through `TabPanel` → `ActiveTab` → `HubOverview`; `null` means this viewer
 * may not change the channel, so the mirror renders no affordance at all.
 */
import { createContext, useContext } from 'react';

export interface HubSettingsValue {
    /** Opens the channel picker, or `null` when the viewer may not pick one. */
    openChannelPicker: (() => void) | null;
}

const HubSettingsContext = createContext<HubSettingsValue>({ openChannelPicker: null });

export const HubSettingsProvider = HubSettingsContext.Provider;

export function useHubSettings(): HubSettingsValue {
    return useContext(HubSettingsContext);
}
