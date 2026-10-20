import type { HubViewerState, LadderRole } from '@raid-ledger/contract';
import type { CommunityRole } from './community-membership.queries';

/** ROK-1870 D7 / §2.5 — the pure role rules of a community hub. */

/**
 * May `actor` remove or ban a user whose LIVE role is `target` (null = not
 * a live member)? Officers act on members only, the Leader on officers too,
 * nobody on the Leader (staff resolve to `leader` upstream).
 */
export function mayModerate(
  actor: LadderRole,
  target: CommunityRole | null,
): boolean {
  if (target === 'leader') return false;
  if (actor === 'leader') return true;
  if (actor === 'officer') return target !== 'officer';
  return false;
}

/** M14: a Leader may archive; only staff restore. */
export function mayChangeStatus(
  staff: boolean,
  role: LadderRole,
  to: 'active' | 'archived',
): boolean {
  if (staff) return true;
  return role === 'leader' && to === 'archived';
}

/** The membership fields `viewerStateOf` reads. */
export interface ViewerRowFields {
  role: CommunityRole;
  leftAt: Date | null;
  bannedAt: Date | null;
}

/** A row → the directory card's `viewer` state. */
export function viewerStateOf(row: ViewerRowFields | null): HubViewerState {
  if (row === null) return 'not-member';
  if (row.bannedAt !== null) return 'banned';
  if (row.leftAt !== null) return 'not-member';
  return row.role;
}
