/**
 * ROK-1893 P1 — pure rules of hub invite links. The token shape is the
 * private-poll share token (ROK-1750): re-exported, never forked. Never log
 * a token — callers log the invite id.
 */
import {
  HUB_INVITE_DEFAULT_EXPIRY_HOURS,
  type HubInviteState,
  type LadderRole,
} from '@raid-ledger/contract';

export {
  generateShareToken as generateHubInviteToken,
  isWellFormedShareToken as isWellFormedHubInviteToken,
} from '../../../lineups/standalone-poll/standalone-poll-share.helpers';

/** 409 copy at the per-member live-link cap (ruling §8d). */
export const INVITE_CAP_MESSAGE = 'Revoke one to make another';

const HOUR_MS = 3_600_000;

/** The fields of an invite row the state rules read. */
export interface InviteStateFields {
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
}

/** ok / revoked / expired / exhausted — revoked wins, then expired. */
export function inviteState(
  row: InviteStateFields,
  now: Date,
): Exclude<HubInviteState, 'hub-unavailable'> {
  if (row.revokedAt !== null) return 'revoked';
  if (row.expiresAt !== null && row.expiresAt <= now) return 'expired';
  if (row.maxUses !== null && row.useCount >= row.maxUses) return 'exhausted';
  return 'ok';
}

/** Omitted ⇒ the 7-day default; null ⇒ never expires. */
export function expiryFrom(
  expiresInHours: number | null | undefined,
  now: Date,
): Date | null {
  if (expiresInHours === null) return null;
  const hours = expiresInHours ?? HUB_INVITE_DEFAULT_EXPIRY_HOURS;
  return new Date(now.getTime() + hours * HOUR_MS);
}

/** Who is asking about an invite: their ladder role on the hub + staff flag. */
export interface InviteViewer {
  userId: number;
  role: LadderRole;
  staff: boolean;
}

/** Leader/Officer of the hub, or staff — they see and revoke every link. */
export function managesInvites(viewer: InviteViewer): boolean {
  return viewer.staff || viewer.role === 'leader' || viewer.role === 'officer';
}

/** The maker, a Leader/Officer, or staff may revoke (and see the token). */
export function canRevokeInvite(
  viewer: InviteViewer,
  createdBy: number | null,
): boolean {
  return managesInvites(viewer) || createdBy === viewer.userId;
}

/** Absolute `/h/:token` landing link. */
export function inviteUrl(clientUrl: string, token: string): string {
  return `${clientUrl.replace(/\/+$/, '')}/h/${token}`;
}
