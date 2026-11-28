/**
 * ROK-2371 D1(a), Discord side: the marker the Discord strategy hands the
 * login callback (as `req.user`) instead of a user, when an unknown snowflake
 * signs in while Google sign-in is live. The callback parks it.
 */
import type { PendingIdentity } from './pending-identity.store';

export interface PendingDiscordMarker {
  pendingDiscord: PendingIdentity;
}

export function isPendingDiscordMarker(v: unknown): v is PendingDiscordMarker {
  if (typeof v !== 'object' || v === null || !('pendingDiscord' in v)) {
    return false;
  }
  const { pendingDiscord } = v;
  return (
    typeof pendingDiscord === 'object' &&
    pendingDiscord !== null &&
    'provider' in pendingDiscord &&
    pendingDiscord.provider === 'discord'
  );
}

/** A signed-in user's numeric id off `req.user`, or null. */
export function userIdOf(v: unknown): number | null {
  if (typeof v !== 'object' || v === null || !('id' in v)) return null;
  return typeof v.id === 'number' ? v.id : null;
}

/** `/auth/first-time` on `base`, optionally carrying a PUG invite code. */
export function firstTimeUrl(base: string, inviteCode: unknown): string {
  if (typeof inviteCode !== 'string' || !inviteCode) {
    return `${base}/auth/first-time`;
  }
  return `${base}/auth/first-time?invite=${encodeURIComponent(inviteCode)}`;
}

/**
 * The `/auth/success` landing for a created Discord account, carrying the
 * parked PUG invite exactly as today's invite sign-in does (`&invite=`).
 */
export function withParkedInvite(
  landing: string,
  parked: Pick<PendingIdentity, 'provider' | 'inviteCode'>,
): string {
  if (parked.provider !== 'discord' || !parked.inviteCode) return landing;
  return `${landing}&invite=${encodeURIComponent(parked.inviteCode)}`;
}
