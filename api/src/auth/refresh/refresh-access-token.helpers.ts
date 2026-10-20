/**
 * ROK-1754 §3.4.4: the access JWT `/auth/refresh` mints. While the family's
 * impersonation marker is live and valid it is the TARGET's token
 * (`impersonatedBy` = the admin, `exp` capped at the marker's `expires_at`);
 * otherwise it is the cookie holder's own 1h token.
 */
import type { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ImpersonationSessionService } from '../impersonation/impersonation-session.service';
import {
  BornExpiredTokenError,
  signAccessToken,
} from '../access-token-mint.helpers';
import { hashToken } from './refresh-token.helpers';

export interface RefreshAccessTokenDeps {
  db: PostgresJsDatabase<typeof schema>;
  jwt: Pick<JwtService, 'sign'>;
  impersonation: Pick<ImpersonationSessionService, 'resolveForRefresh'>;
}

/** The just-rotated refresh row the access token is minted for. */
export interface RotatedRow {
  userId: number;
  familyId: string;
  /** The child's raw token — locates the row for the snapshot read. */
  rawToken: string;
}

/** ROK-1823 D5b: the rotated row + its holder, read in ONE statement. */
export interface HolderSnapshot {
  id: number;
  username: string;
  role: (typeof schema.users.$inferSelect)['role'];
  tokenVersion: number;
}

/**
 * Mint the access token for a just-rotated refresh row. Resolves `null` when
 * that row was revoked after the rotation committed (a concurrent
 * revokeFamily/revokeAllForUser) — the caller answers 401 like any invalid
 * refresh. ROK-1823 D5b: the holder's role and token version come from the
 * SAME snapshot that proved the row live, so a password change either commits
 * after it (its bump kills this token) or before it (row revoked → null).
 */
export async function mintRefreshAccessToken(
  deps: RefreshAccessTokenDeps,
  rotated: RotatedRow,
): Promise<string | null> {
  const holder = await readHolderSnapshot(deps.db, rotated.rawToken);
  if (!holder) return null;
  const live = await deps.impersonation.resolveForRefresh(
    rotated.familyId,
    holder.id,
  );
  if (!live) return signOwnAccessToken(deps, holder);
  return signImpersonationAccessToken(deps, holder, live);
}

/**
 * `refresh_tokens ⋈ users` on the rotated row's hash. `null` when the row is
 * gone or revoked — nothing about the holder is read separately.
 */
export async function readHolderSnapshot(
  db: RefreshAccessTokenDeps['db'],
  rawToken: string,
): Promise<HolderSnapshot | null> {
  const [row] = await db
    .select({
      revokedAt: schema.refreshTokens.revokedAt,
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      tokenVersion: schema.users.tokenVersion,
    })
    .from(schema.refreshTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.refreshTokens.userId))
    .where(eq(schema.refreshTokens.tokenHash, hashToken(rawToken)))
    .limit(1);
  if (!row || row.revokedAt != null) return null;
  const { id, username, role, tokenVersion } = row;
  return { id, username, role, tokenVersion };
}

type LiveImpersonation = NonNullable<
  Awaited<
    ReturnType<RefreshAccessTokenDeps['impersonation']['resolveForRefresh']>
  >
>;

/**
 * The target's token, `exp` capped at the marker's `expires_at`. `tv` is the
 * target's version (read with its role, D6); `itv` is the HOLDER's version
 * from the snapshot — never a later read, so an admin whose password changed
 * mid-refresh cannot mint a valid target token. A deadline inside the current
 * second ends the impersonation: the holder gets their own token instead.
 */
function signImpersonationAccessToken(
  deps: RefreshAccessTokenDeps,
  holder: HolderSnapshot,
  live: LiveImpersonation,
): string {
  const { target, expiresAt } = live;
  try {
    return signAccessToken(
      deps,
      {
        sub: target.id,
        username: target.username,
        role: target.role,
        impersonatedBy: holder.id,
        tv: target.tokenVersion,
        itv: holder.tokenVersion,
      },
      { notAfter: expiresAt },
    );
  } catch (err) {
    if (!(err instanceof BornExpiredTokenError)) throw err;
    return signOwnAccessToken(deps, holder);
  }
}

/** The cookie holder's own 1h access token, from the snapshot. */
function signOwnAccessToken(
  deps: RefreshAccessTokenDeps,
  holder: HolderSnapshot,
): string {
  return signAccessToken(deps, {
    username: holder.username,
    sub: holder.id,
    role: holder.role,
    tv: holder.tokenVersion,
  });
}
