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

export interface RefreshAccessTokenDeps {
  db: PostgresJsDatabase<typeof schema>;
  jwt: Pick<JwtService, 'sign'>;
  /** ROK-1810: the block floor, so a same-second mint is not born revoked. */
  blocklist: Pick<TokenBlocklistService, 'minIatFor'>;
  impersonation: Pick<ImpersonationSessionService, 'resolveForRefresh'>;
}

/** Mint the access token for a just-rotated refresh row. */
export async function mintRefreshAccessToken(
  deps: RefreshAccessTokenDeps,
  rotated: { userId: number; familyId: string },
): Promise<string> {
  const live = await deps.impersonation.resolveForRefresh(
    rotated.familyId,
    rotated.userId,
  );
  if (!live) return signOwnAccessToken(deps, rotated.userId);
  const { target, expiresAt } = live;
  return signAccessToken(
    deps,
    {
      sub: target.id,
      username: target.username,
      role: target.role,
      impersonatedBy: rotated.userId,
    },
    { expiresIn: secondsUntil(expiresAt, new Date()) },
  );
}

/** The cookie holder's own 1h access token (module default `expiresIn`). */
async function signOwnAccessToken(
  deps: RefreshAccessTokenDeps,
  userId: number,
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
  return signAccessToken(deps, {
    username: user.username,
    sub: user.id,
    role: user.role,
  });
}
