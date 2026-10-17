/**
 * DEMO_MODE-only test helpers added by ROK-1070. Extracted from
 * demo-test.service.ts to keep that file under the 300-line ESLint cap.
 * Helpers perform raw DB writes — callers must invoke `assertDemoMode`
 * on `DemoTestService` first, since the gate lives there.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Clear onboarding flags for a user (ROK-1070). Sets
 * `onboardingCompletedAt` and `gameTimeConfirmedAt` to NULL so the
 * onboarding wizard renders fresh on `?rerun=1`.
 */
export async function resetOnboardingForTest(
  db: Db,
  userId: number,
): Promise<void> {
  await db
    .update(schema.users)
    .set({
      onboardingCompletedAt: null,
      gameTimeConfirmedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}

/**
 * Hard-delete events whose title begins with `titlePrefix` (ROK-1070).
 * Mirrors `resetLineupsForTest` — per-worker scoping prevents siblings'
 * events from being touched. FK `onDelete: cascade` removes
 * `event_signups` and other children.
 *
 * Wildcard chars in the prefix are escaped against LIKE.
 */
export async function resetEventsForTest(
  db: Db,
  titlePrefix: string,
): Promise<{ deletedCount: number }> {
  const escaped = titlePrefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `${escaped}%`;
  const result = await db
    .delete(schema.events)
    .where(sql`${schema.events.title} LIKE ${pattern}`)
    .returning({ id: schema.events.id });
  return { deletedCount: result.length };
}
