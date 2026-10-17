/**
 * WoW Dungeon Finder role icon URLs.
 * PNGs served from /icons/roles/ (web/public/icons/roles/).
 * Keys match the role strings used throughout the app.
 */

export const WOW_ROLE_ICONS: Record<string, string> = {
  tank: '/icons/roles/tank.png',
  healer: '/icons/roles/healer.png',
  dps: '/icons/roles/dps.png',
};

/** Get role icon URL, or null if not a recognized role. */
export function getRoleIconUrl(role: string | null | undefined): string | null {
  if (!role) return null;
  return WOW_ROLE_ICONS[role] ?? null;
}
