/**
 * ROK-2099 — the WoW plugin's Admin → General → "Addon errors" page: its path
 * and its nav row. The row exists only while the `blizzard` plugin is active
 * (ruling 9); the settings layout already limits these pages to admins.
 */
import type { NavItem } from '../../../components/admin/admin-nav-data';
import { usePluginStore } from '../../../stores/plugin-store';

export const ADDON_ERRORS_PLUGIN = 'blizzard';
export const ADDON_ERRORS_PATH = '/admin/settings/general/addon-errors';

const NAV_ITEMS: readonly NavItem[] = [{ to: ADDON_ERRORS_PATH, label: 'Addon errors' }];
const NONE: readonly NavItem[] = [];

/** The General-section rows this plugin adds (after Logs); empty while `blizzard` is off. */
export function useAddonErrorsNavItems(): readonly NavItem[] {
    const active = usePluginStore((s) => s.isPluginActive(ADDON_ERRORS_PLUGIN));
    return active ? NAV_ITEMS : NONE;
}
