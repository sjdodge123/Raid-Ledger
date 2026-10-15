/**
 * ROK-1313: per-user screenshot cleanup, shared by the account-delete listener
 * and the ban + wipe path (which deletes feedback rows WITHOUT `user.deleting`).
 * Collect the paths BEFORE the rows go — inside the wipe's transaction — and
 * delete the files only AFTER it commits, so a rolled-back wipe keeps them.
 */
import type { Logger } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { deleteScreenshotFiles } from './feedback-screenshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Stored screenshot paths for every feedback row the user owns. */
export async function selectUserScreenshotPaths(
  db: Db,
  userId: number,
): Promise<string[]> {
  const t = schema.feedback;
  const rows = await db
    .select({ path: t.screenshotPath })
    .from(t)
    .where(and(eq(t.userId, userId), isNotNull(t.screenshotPath)));
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
