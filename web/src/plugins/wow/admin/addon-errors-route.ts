/**
 * ROK-2099 — the WoW plugin's Admin → General → "Addon errors" page: its path
 * and its nav row. `register.ts` hands the row to core through
 * `registerAdminGeneralNavItems`, so it shows only while the `blizzard` plugin
 * is active (ruling 9); the settings layout already limits these pages to admins.
 */
import type { NavItem } from '../../../components/admin/admin-nav-data';

export const ADDON_ERRORS_PLUGIN = 'blizzard';
export const ADDON_ERRORS_PATH = '/admin/settings/general/addon-errors';

/** The General-section rows this plugin adds (after Logs). */
export const ADDON_ERRORS_NAV_ITEMS: readonly NavItem[] = [{ to: ADDON_ERRORS_PATH, label: 'Addon errors' }];
