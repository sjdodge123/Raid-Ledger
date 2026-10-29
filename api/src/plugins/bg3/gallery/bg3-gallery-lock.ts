/**
 * ROK-1959 Codex P1 — the per-uploader Gallery lock. The sync reads a save's
 * bytes, then queues the `hub_media` insert; delete-my-data could delete the
 * save in between, and its cleanup (which only sees rows already present)
 * would leave the copied picture live. So the copy re-checks that the save
 * still exists and inserts while holding this lock, and
 * `Bg3MyDataRepository.deleteAllFor` takes it before deleting saves. Either
 * the copy lands first (and the cleanup tombstones it) or the save is gone
 * when the copy re-checks (and nothing is stored).
 *
 * One-argument `(bigint)` form over `hashtext`, its own text key, held until
 * the transaction ends. The insert runs on the outer `db` and autocommits
 * before the lock's transaction does. Order: delete-my-data takes the
 * companion blob lock first, then this one; the copy takes only this one.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Anything that can run one statement inside the caller's transaction. */
export interface Bg3GalleryLockTx {
  execute(query: SQL): PromiseLike<unknown>;
}

/** The lock's text key for one uploader. */
export function bg3GalleryLockKey(userId: number): string {
  return `bg3-gallery:${userId}`;
}

/** Take the uploader's Gallery lock until the transaction ends. */
export async function lockBg3Gallery(
  tx: Bg3GalleryLockTx,
  userId: number,
): Promise<void> {
  const key = bg3GalleryLockKey(userId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

/** The save the pick was read from, still present with the same picture. */
export interface Bg3GallerySource {
  saveId: number;
  uploaderUserId: number;
  sha256: string;
}

/**
 * Run `copy` under the uploader's lock only if the source save still exists
 * with the same thumbnail; `null` when it was deleted meanwhile.
 */
export function copyUnderUploaderLock<T>(
  db: Db,
  source: Bg3GallerySource,
  copy: () => Promise<T>,
): Promise<T | null> {
  const s = schema.bg3Saves;
  return db.transaction(async (tx) => {
    await lockBg3Gallery(tx, source.uploaderUserId);
    const [live] = await tx
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.id, source.saveId), eq(s.thumbnailSha256, source.sha256)))
      .limit(1);
    return live ? copy() : null;
  });
}
