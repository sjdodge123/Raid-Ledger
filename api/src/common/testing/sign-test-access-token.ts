/**
 * ROK-1823: integration specs that need a session without a login round trip
 * sign it here. Every access JWT must carry `tv` equal to the sub's current
 * `users.token_version` (and, on an impersonation token, `itv` equal to the
 * impersonator's) or JwtStrategy 401s it. The versions are read from the row
 * at sign time, never hard-coded, so a spec that bumps a version first still
 * gets a token for the version that is current now.
 */
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { UserRole } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { TestApp } from './test-app';

/** The claims a spec chooses; `tv` / `itv` are filled in from the DB. */
export interface TestAccessClaims {
  sub: number;
  username: string;
  role?: UserRole;
  impersonatedBy?: number;
}

/** `users.token_version` for `userId`; throws when the row is missing. */
export async function currentTokenVersion(
  db: TestApp['db'],
  userId: number,
): Promise<number> {
  const [row] = await db
    .select({ tv: schema.users.tokenVersion })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!row) throw new Error(`currentTokenVersion: no user ${userId}`);
  return row.tv;
}

/** Sign an access JWT carrying the sub's (and impersonator's) live version. */
export async function signTestAccessToken(
  testApp: Pick<TestApp, 'app' | 'db'>,
  claims: TestAccessClaims,
): Promise<string> {
  const tv = await currentTokenVersion(testApp.db, claims.sub);
  const admin = claims.impersonatedBy;
  const itv =
    admin === undefined
      ? {}
      : { itv: await currentTokenVersion(testApp.db, admin) };
  return testApp.app.get(JwtService).sign({ ...claims, tv, ...itv });
}
