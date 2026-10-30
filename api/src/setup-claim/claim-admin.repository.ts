/**
 * ROK-1701: the single account a claim sets — the bootstrap `admin@local`
 * local credential. Plain functions over a drizzle db / tx (shared by the
 * claim service, the DEMO_MODE fixture and bootstrap). Never log a hash.
 */
import { eq } from 'drizzle-orm';
import { localCredentials } from '../drizzle/schema';
import type { ClaimDb } from './claim-state.repository';

export const CLAIM_ADMIN_EMAIL = 'admin@local';

/** admin@local's current bcrypt hash, or null when it has no credential. */
export async function readAdminPasswordHash(
  db: ClaimDb,
): Promise<string | null> {
  const rows = await db
    .select({ passwordHash: localCredentials.passwordHash })
    .from(localCredentials)
    .where(eq(localCredentials.email, CLAIM_ADMIN_EMAIL))
    .limit(1);
  return rows[0]?.passwordHash ?? null;
}

/** Replace admin@local's hash. Returns its user id, or null when there is no
 *  admin@local credential linked to a user. */
export async function setAdminPasswordHash(
  db: ClaimDb,
  passwordHash: string,
): Promise<number | null> {
  const rows = await db
    .update(localCredentials)
    .set({ passwordHash })
    .where(eq(localCredentials.email, CLAIM_ADMIN_EMAIL))
    .returning({ userId: localCredentials.userId });
  return rows[0]?.userId ?? null;
}
