/**
 * Single-row signup writes for SignupsService. Each one addresses a signup
 * the caller has already loaded by primary key, so `.returning()` yields it.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import type { Tx } from './signups.service.types';

type SignupPatch = Partial<typeof schema.eventSignups.$inferInsert>;

/** Update one signup by id and return the updated row. */
export async function updateSignupById(
  db: Tx,
  signupId: number,
  patch: SignupPatch,
) {
  const [row] = await db
    .update(schema.eventSignups)
    .set(patch)
    .where(eq(schema.eventSignups.id, signupId))
    .returning();
  return defined(row, `updated signup ${signupId}`);
}
