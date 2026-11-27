/**
 * ROK-2371: the id_token claim checks and account refusals for Sign in with
 * Google. Reused by the Profile link flow (L2c).
 *
 * `parseGoogleIdToken` (calendar, unchanged) checks iss/aud/exp/sub; this
 * adds the OIDC `nonce` and reads `email_verified` + a display name. The
 * email is display-only — never a lookup key (ruling 1).
 */
import { timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { parseGoogleIdToken } from '../../calendar-sync/providers/google/google-oauth.helpers';
import {
  assertKickCooldownOrClear,
  assertNotBanned,
} from '../auth-status.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type UserRow = typeof schema.users.$inferSelect;

const DISPLAY_NAME_MAX = 64;
const FALLBACK_NAME = 'Google user';

export interface GoogleSigninClaims {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
}

/** A claim the sign-in flow rejects (beyond the calendar's own checks). */
export class GoogleSigninClaimError extends Error {
  constructor(readonly claim: 'nonce' | 'payload') {
    super(`Invalid Google id_token: ${claim}`);
  }
}

function decodePayload(idToken: string): Record<string, unknown> {
  const part = idToken.split('.')[1];
  if (!part) throw new GoogleSigninClaimError('payload');
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(part, 'base64url').toString('utf8'),
    );
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...parsed };
    }
  } catch {
    // fall through
  }
  throw new GoogleSigninClaimError('payload');
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** given_name, else name, trimmed and capped; a fixed fallback otherwise. */
export function pickDisplayName(claims: Record<string, unknown>): string {
  for (const value of [claims.given_name, claims.name]) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, DISPLAY_NAME_MAX);
    }
  }
  return FALLBACK_NAME;
}

/**
 * Validate a sign-in id_token: calendar checks + `nonce === expectedNonce`.
 * `email_verified` is reported, not enforced — the caller decides (it is
 * required to create an account or a pending identity, spec §3).
 */
export function readGoogleSigninClaims(
  idToken: string,
  clientId: string,
  expectedNonce: string,
  nowMs = Date.now(),
): GoogleSigninClaims {
  const { sub, email } = parseGoogleIdToken(idToken, clientId, nowMs);
  const claims = decodePayload(idToken);
  const { nonce } = claims;
  if (typeof nonce !== 'string' || !sameString(nonce, expectedNonce)) {
    throw new GoogleSigninClaimError('nonce');
  }
  return {
    sub,
    email,
    emailVerified: claims.email_verified === true,
    displayName: pickDisplayName(claims),
  };
}

export type SigninRefusalReason =
  'banned' | 'kicked' | 'deactivated' | 'unverified' | 'oauth_failed';

export interface SigninRefusal {
  reason: SigninRefusalReason;
  message?: string;
}

/** Ruling 2 copy (spec §3). */
export const DEACTIVATED_SIGNIN_MESSAGE =
  'Your account was deactivated when you left the Discord server. Rejoin it, then sign in with Discord.';

function messageOf(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const body = err.getResponse();
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string') return message;
  }
  return err.message;
}

async function statusRefusal(
  db: Db,
  user: UserRow,
): Promise<SigninRefusal | null> {
  try {
    assertNotBanned(user);
  } catch (err) {
    const message = messageOf(err);
    return message === undefined
      ? { reason: 'banned' }
      : { reason: 'banned', message };
  }
  try {
    await assertKickCooldownOrClear(db, user);
  } catch (err) {
    const message = messageOf(err);
    return message === undefined
      ? { reason: 'kicked' }
      : { reason: 'kicked', message };
  }
  return null;
}

/**
 * Banned / kicked-in-cooldown / deactivated → a refusal (ruling 2: the
 * Google path refuses a deactivated user, unlike Discord's). An expired kick
 * is cleared as on the Discord path.
 */
export async function signinRefusalFor(
  db: Db,
  user: UserRow,
): Promise<SigninRefusal | null> {
  const refusal = await statusRefusal(db, user);
  if (refusal) return refusal;
  if (user.deactivatedAt) {
    return { reason: 'deactivated', message: DEACTIVATED_SIGNIN_MESSAGE };
  }
  return null;
}

const ERROR_PARAM: Record<SigninRefusalReason, string> = {
  banned: 'suspended',
  kicked: 'suspended',
  deactivated: 'deactivated',
  unverified: 'google_unverified',
  oauth_failed: 'oauth_failed',
};

/** `/login?error=…[&reason=…]` on `clientUrl` (same params as Discord's). */
export function refusalRedirect(
  clientUrl: string,
  refusal: SigninRefusal,
): string {
  const q = new URLSearchParams({ error: ERROR_PARAM[refusal.reason] });
  if (refusal.message) q.set('reason', refusal.message);
  return `${clientUrl}/login?${q.toString()}`;
}
