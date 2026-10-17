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
import type { TokenBlocklistService } from '../token-blocklist.service';
import {
  BornExpiredTokenError,
  signAccessToken,
} from '../access-token-mint.helpers';
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
  const { floors, nowMs } = pinned;
  const live = await deps.impersonation.resolveForRefresh(
    rotated.familyId,
    rotated.userId,
    (targetId) => pinFloor(deps, floors, targetId),
  );
  const mintDeps = { ...deps, blocklist: pinnedBlocklist(floors) };
  if (!live) return signOwnAccessToken(mintDeps, rotated.userId, nowMs);
  return signImpersonationAccessToken(mintDeps, rotated.userId, live, nowMs);
}

/**
 * The target's token, `exp` capped at the marker's `expires_at` (ROK-1820:
 * from the pinned clock, never the floor-raised `iat`). When the floor leaves
 * no lifetime before that deadline the impersonation is over, so the holder
 * gets their own token instead of a born-expired one.
 */
async function signImpersonationAccessToken(
  deps: RefreshAccessTokenDeps,
  holderId: number,
  live: LiveImpersonation,
  nowMs: number,
): Promise<string> {
  const { target, expiresAt } = live;
  try {
    return await signAccessToken(
      deps,
      {
        sub: target.id,
        username: target.username,
        role: target.role,
        impersonatedBy: holderId,
      },
      { notAfter: expiresAt },
      nowMs,
    );
  } catch (err) {
    if (!(err instanceof BornExpiredTokenError)) throw err;
    return signOwnAccessToken(deps, holderId, nowMs);
  }
}

type LiveImpersonation = NonNullable<
  Awaited<
    ReturnType<RefreshAccessTokenDeps['impersonation']['resolveForRefresh']>
  >
>;

/** Block floors read once, before anything they guard was validated. */
type PinnedFloors = Map<number, number | undefined>;

/**
 * Codex r2 revoke race + Codex r4 promotion race. Every floor the mint signs
 * with is read ONCE, against the clock pinned at (1), and never re-read at
 * sign time. ORDER MATTERS — revokeFamily/revokeAllForUser commit the revoke
 * in Postgres BEFORE `blockUser` writes Redis, and `setRole` commits the role
 * BEFORE it blocks, so:
 *   1. take the clock, 2. read the holder's floor, 3. re-read the rotated
 *   row (ALWAYS — ROK-1820: a password change commits its revoke before its
 *   block, so a floor read in that gap sees no floor although the row is
 *   already revoked; without this the refresh minted an old-session token
 *   and Set-Cookie'd a revoked `rl_rt`); then, for an impersonation family,
 *   4. read the TARGET's floor (`pinFloor`, via `resolveForRefresh`'s
 *   `beforeValidate`), 5. only then load + validate the target's role.
 * A block visible at (2) implies its revoke is visible at (3); a promotion
 * block visible at (4) implies the admin role is visible at (5), which ends
 * the impersonation. A block written after (2) or (4) stamps `>= floor(clock)`
 * (monotonic `blockUser`), which is `>=` the iat signed here — so the token
 * stays revocable by both ids.
 */
async function pinHolderFloor(
  deps: RefreshAccessTokenDeps,
  rotated: RotatedRow,
): Promise<{ floors: PinnedFloors; nowMs: number } | null> {
  const nowMs = Date.now();
  const floor = await deps.blocklist.minIatFor(rotated.userId);
  if (await rowIsGone(deps.db, rotated.rawToken)) return null;
  return { floors: new Map([[rotated.userId, floor]]), nowMs };
}

/** Read and keep one user's floor; a floor already pinned is never re-read. */
async function pinFloor(
  deps: RefreshAccessTokenDeps,
  floors: PinnedFloors,
  userId: number,
): Promise<void> {
  if (floors.has(userId)) return;
  floors.set(userId, await deps.blocklist.minIatFor(userId));
}

/** Serves only pinned floors; an unpinned id fails closed (no late read). */
function pinnedBlocklist(
  floors: PinnedFloors,
): RefreshAccessTokenDeps['blocklist'] {
  return {
    minIatFor: (id: number) =>
      floors.has(id)
        ? Promise.resolve(floors.get(id))
        : Promise.reject(new Error(`block floor for user ${id} not pinned`)),
  };
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

/** The cookie holder's own 1h access token (`ACCESS_TOKEN_TTL_SECONDS`). */
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
