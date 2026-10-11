/**
 * ROK-1754: pure rules for the server-side impersonation marker
 * (`refresh_family_impersonations`). No DB access — the service feeds rows in.
 */
import type { UserRole } from '@raid-ledger/contract';

/** Absolute cap on one impersonation, from start (never slid). */
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000;

/** Why a marker ended. Written to the `impersonate_stop` audit metadata. */
export type ImpersonationEndReason =
  | 'user_exit'
  | 'logout'
  | 'session_revoked'
  | 'expired'
  | 'session_mismatch'
  | 'impersonator_role_lost'
  | 'impersonator_suspended'
  | 'replaced'
  | 'user_wiped'
  | 'target_promoted'
  | 'target_suspended';

export interface MarkerLike {
  impersonatorUserId: number;
  expiresAt: Date;
}

export interface UserLike {
  id: number;
  role: UserRole;
  bannedAt: Date | null;
  kickedAt?: Date | null;
}

/** `expires_at` for a marker started at `now`. */
export function markerExpiry(now: Date): Date {
  return new Date(now.getTime() + IMPERSONATION_TTL_MS);
}

/** Whole seconds until `expiresAt` (≥1), for `jwtService.sign({ expiresIn })`. */
export function secondsUntil(expiresAt: Date, now: Date): number {
  return Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * Spec §3.4.2 validity rules, in order. Returns the end reason, or null when
 * the impersonation may continue. A deactivated target is NOT a failure
 * (matches NotDeactivatedGuard's impersonation bypass).
 */
export function markerEndReason(
  marker: MarkerLike,
  refreshUserId: number,
  impersonator: UserLike | null,
  target: UserLike | null,
  now: Date,
): ImpersonationEndReason | null {
  if (marker.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (marker.impersonatorUserId !== refreshUserId) return 'session_mismatch';
  const role = impersonator?.role;
  if (role !== 'operator' && role !== 'admin') return 'impersonator_role_lost';
  if (impersonator?.bannedAt || impersonator?.kickedAt) {
    return 'impersonator_suspended';
  }
  if (!target || target.role === 'admin') return 'target_promoted';
  if (target.bannedAt) return 'target_suspended';
  return null;
}

/** JSON audit metadata for `admin_actions.metadata`. */
export function auditMetadata(fields: {
  familyId: string | null;
  persistent: boolean;
  reason?: ImpersonationEndReason;
}): string {
  return JSON.stringify({
    ...(fields.reason ? { reason: fields.reason } : {}),
    persistent: fields.persistent,
    familyId: fields.familyId,
  });
}
