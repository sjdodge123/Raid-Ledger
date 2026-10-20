/** ROK-1832 — D11 visibility for the per-group notification bell. */
import type { GuildViewerAccess } from '@raid-ledger/contract';

const MEMBER_ROLES: ReadonlySet<GuildViewerAccess['role']> = new Set(['member', 'officer', 'leader']);

/**
 * The viewer is a real member of this group: a member ladder role AND the page
 * carries their mute (the API omits `notificationsMuted` for non-members, staff included).
 */
export function hubBellVisible(viewer: GuildViewerAccess): boolean {
    return MEMBER_ROLES.has(viewer.role) && viewer.notificationsMuted !== undefined;
}
