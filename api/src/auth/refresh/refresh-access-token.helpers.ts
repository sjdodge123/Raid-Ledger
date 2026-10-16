/**
 * ROK-1754 §3.4.4: the access JWT `/auth/refresh` mints. While the family's
 * impersonation marker is live and valid it is the TARGET's token
 * (`impersonatedBy` = the admin, `exp` capped at the marker's `expires_at`);
 * otherwise it is the cookie holder's own 1h token.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ImpersonationSessionService } from '../impersonation/impersonation-session.service';
import { secondsUntil } from '../impersonation/impersonation-session.helpers';
import type { TokenBlocklistService } from '../token-blocklist.service';
import { signAccessToken } from '../access-token-mint.helpers';
import { hashToken } from './refresh-token.helpers';

export interface RefreshAccessTokenDeps {
  db: PostgresJsDatabase<typeof schema>;
  jwt: Pick<JwtService, 'sign'>;
  /** ROK-1810: the block floor, so a same-second mint is not born revoked. */
  blocklist: Pick<TokenBlocklistService, 'minIatFor'>;
  impersonation: Pick<ImpersonationSessionService, 'resolveForRefresh'>;
}

/** The just-rotated refresh row the access token is minted for. */
export interface RotatedRow {
  userId: number;
  familyId: string;
  /** The child's raw token — locates the row for the revoke re-check. */
  rawToken: string;
}

/**
 * Mint the access token for a just-rotated refresh row. Resolves `null` when
 * that row was revoked after the rotation committed (a concurrent
 * revokeFamily/revokeAllForUser) — the caller answers 401 like any invalid
 * refresh.
 */
export async function mintRefreshAccessToken(
  deps: RefreshAccessTokenDeps,
  rotated: RotatedRow,
): Promise<string | null> {
  const pinned = await pinHolderFloor(deps, rotated);
  if (!pinned) return null;
  const { mintDeps, nowMs } = pinned;
  const live = await deps.impersonation.resolveForRefresh(
    rotated.familyId,
    rotated.userId,
  );
  if (!live) return signOwnAccessToken(mintDeps, rotated.userId, nowMs);
  const { target, expiresAt } = live;
  return signAccessToken(
    mintDeps,
    {
      sub: target.id,
      username: target.username,
      role: target.role,
      impersonatedBy: rotated.userId,
    },
    { expiresIn: secondsUntil(expiresAt, new Date()) },
    nowMs,
  );
}

/**
 * Codex r2 revoke race: a rotation that commits just before a revoke + block
 * would otherwise mint with the raised floor and outlive the revoke by an
 * hour. ORDER MATTERS — revokeFamily/revokeAllForUser commit the revoke in
 * Postgres BEFORE `blockUser` writes Redis, so:
 *   1. take the clock, 2. read the holder's floor, 3. only when a floor
 *   exists, re-read the rotated row.
 * A block visible at (2) implies its revoke is visible at (3). A block
 * written after (2) stamps `>= floor(clock)` (monotonic `blockUser`), which
 * is `>=` the iat signed here — so the floor is pinned (signing must not
 * re-read a newer one) and the clock is pinned to (1).
 */
async function pinHolderFloor(
  deps: RefreshAccessTokenDeps,
  rotated: RotatedRow,
): Promise<{ mintDeps: RefreshAccessTokenDeps; nowMs: number } | null> {
  const nowMs = Date.now();
  const floor = await deps.blocklist.minIatFor(rotated.userId);
  if (floor !== undefined && (await rowIsGone(deps.db, rotated.rawToken))) {
    return null;
  }
  const blocklist = {
    minIatFor: (id: number) =>
      id === rotated.userId
        ? Promise.resolve(floor)
        : deps.blocklist.minIatFor(id),
  };
  return { mintDeps: { ...deps, blocklist }, nowMs };
}

/** The rotated row is revoked (or no longer exists). */
async function rowIsGone(
  db: RefreshAccessTokenDeps['db'],
  rawToken: string,
): Promise<boolean> {
  const [row] = await db
    .select({ revokedAt: schema.refreshTokens.revokedAt })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hashToken(rawToken)))
    .limit(1);
  return !row || row.revokedAt != null;
}

/** The cookie holder's own 1h access token (module default `expiresIn`). */
async function signOwnAccessToken(
  deps: RefreshAccessTokenDeps,
  userId: number,
  nowMs: number,
): Promise<string> {
  const [user] = await deps.db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new UnauthorizedException('User not found');
  return signAccessToken(
    deps,
    { username: user.username, sub: user.id, role: user.role },
    undefined,
    nowMs,
  );
}
