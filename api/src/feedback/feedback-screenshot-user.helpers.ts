/**
 * ROK-1313: per-user screenshot cleanup, shared by account delete
 * (`deleteUserTransaction`) and the ban + wipe path.
 * Collect the paths BEFORE the rows go — inside the wipe's transaction — and
 * delete the files only AFTER it commits, so a rolled-back wipe keeps them.
 */
import type { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { deleteScreenshotFiles } from './feedback-screenshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Stored screenshot paths for every feedback row the user owns. MUST run in
 * the transaction that then deletes those rows: it locks them so a concurrent
 * `storeScreenshot` cannot slip a path in unseen. Locking the user row first
 * blocks new feedback inserts (their FK check needs it); locking ALL the
 * user's feedback rows — not only those with a path, since an in-flight store
 * is updating a null one — waits out a path update in progress and reads its
 * committed value. A store that comes after the lock blocks until the delete
 * commits, then updates no row and removes its own file.
 */
export async function selectUserScreenshotPaths(
  tx: Db,
  userId: number,
): Promise<string[]> {
  await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for('update');
  const t = schema.feedback;
  const rows = await tx
    .select({ path: t.screenshotPath })
    .from(t)
    .where(eq(t.userId, userId))
    .for('update');
  return rows.flatMap((r) => (r.path ? [r.path] : []));
}

/** Delete the files. Best-effort: never throws, so a disk error never fails the caller. */
export async function deleteUserScreenshotsBestEffort(
  paths: readonly string[],
  userId: number,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  try {
    const refused = await deleteScreenshotFiles(paths);
    if (refused.length > 0) {
      logger.warn(
        `user ${userId}: refused ${refused.length} screenshot path(s) outside the feedback dir`,
      );
    }
  } catch (err) {
    const code = err instanceof Error ? err.name : 'unknown';
    logger.warn(`screenshot cleanup for user ${userId} failed (${code})`);
  }
}
