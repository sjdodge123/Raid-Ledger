import { ownLookup } from '../../lib/own-lookup';

/**
 * Signup role icon URLs (tank / healer / dps are core signup roles, not a
 * plugin's). PNGs served from /icons/roles/ (web/public/icons/roles/).
 * Keys match the role strings used throughout the app. ROK-2359: moved to
 * core from the WoW plugin so `RoleIcon` needs no plugin import.
 */

export const ROLE_ICONS: Record<string, string> = {
  tank: '/icons/roles/tank.png',
  healer: '/icons/roles/healer.png',
  dps: '/icons/roles/dps.png',
};

/** Get role icon URL, or null if not a recognized role. */
export function getRoleIconUrl(role: string | null | undefined): string | null {
  if (!role) return null;
  return ownLookup(ROLE_ICONS, role) ?? null;
}
