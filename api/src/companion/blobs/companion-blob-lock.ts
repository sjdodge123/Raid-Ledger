/**
 * ROK-1956 review R1 — the ONE per-user advisory lock every companion blob
 * writer takes: the upload insert, the stale-row repair, the messages
 * transaction before it reads blobs / upserts refs, and each cleanup phase.
 * One key per user (`companion-blobs:<userId>`), transaction-scoped, so a
 * blob being referenced cannot be reaped mid-flight and a ref cannot commit
 * against dims a concurrent upload disagrees with.
 *
 * Order (deadlock-free): a device-path transaction holds its device row
 * (`FOR SHARE`) FIRST, then this lock; nothing takes a device row while
 * holding it. Cleanup never touches device rows. A transaction never takes
 * two users' blob locks.
 */
import { sql, type SQL } from 'drizzle-orm';

/** The lock's text key for one user. */
export function companionBlobLockKey(userId: number): string {
  return `companion-blobs:${userId}`;
}

/** Anything that can run one statement inside the caller's transaction. */
export interface CompanionBlobLockTx {
  execute(query: SQL): PromiseLike<unknown>;
}

/** Take the user's blob lock until the transaction ends. */
export async function lockCompanionUserBlobs(
  tx: CompanionBlobLockTx,
  userId: number,
): Promise<void> {
  const key = companionBlobLockKey(userId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}
