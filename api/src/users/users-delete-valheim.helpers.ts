/**
 * ROK-1835 B1: release a user's Valheim character claims before the users row
 * is hard-deleted. `valheim_profiles.claimed_by` is ON DELETE SET NULL, but the
 * `valheim_profiles_claim_pair_chk` CHECK requires `claimed_by` and
 * `claim_source` to be null together — the FK action alone would leave
 * `claim_source` set and abort the delete. This clears the three claim columns
 * together and writes an `auto_detach` audit row (no actor = system) per
 * released profile, in the caller's transaction.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Unclaim every profile claimed by `userId` and audit each as `auto_detach`. */
export async function releaseValheimClaimsForDeletedUser(
  tx: Db,
  userId: number,
): Promise<void> {
  await tx.execute(sql`
    WITH released AS (
      UPDATE valheim_profiles
         SET claimed_by = NULL, claim_source = NULL, claimed_at = NULL
       WHERE claimed_by = ${userId}
   RETURNING id
    )
    INSERT INTO valheim_profile_claim_events
           (profile_id, action, from_user_id, to_user_id, actor_user_id)
    SELECT id, 'auto_detach', ${userId}, NULL, NULL FROM released`);
}
