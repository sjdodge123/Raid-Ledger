/**
 * ROK-1956 §7.2 + review R1 — the cleanup's SQL. Candidates are found by
 * user without a lock; each delete then re-checks its predicate scoped to
 * ONE user inside a transaction holding that user's blob lock
 * (`companion-blob-lock.ts`), so a concurrent message ref or re-upload
 * either commits first (and is seen) or waits. Raw SQL with explicit
 * aliases so each correlated `NOT EXISTS` binds to the right table.
 */
import { sql } from 'drizzle-orm';
import type { CompanionBlobTx } from './companion-blobs.repository';
import { storedBlobsIn } from './companion-blobs.repository';

/** Anything that can run raw SQL (the db or a transaction). */
type Exec = Pick<CompanionBlobTx, 'execute'>;

const toIds = (rows: Iterable<{ userId: number | string }>): number[] =>
  [...rows].map((r) => Number(r.userId));

/** Users with an unreferenced blob older than `hours` (≤`limit`). */
export async function unreferencedBlobUsers(
  db: Exec,
  hours: number,
  limit: number,
): Promise<number[]> {
  const rows = await db.execute<{ userId: number }>(sql`
    SELECT DISTINCT c.user_id AS "userId" FROM companion_blobs AS c
    WHERE c.created_at < now() - make_interval(hours => ${hours})
      AND NOT EXISTS (SELECT 1 FROM companion_blob_refs AS r
                      WHERE r.user_id = c.user_id AND r.sha256 = c.sha256)
    LIMIT ${limit}`);
  return toIds(rows);
}

/** Under the user's lock: delete ≤`limit` of their unreferenced aged blobs. */
export async function deleteUnreferencedBlobsIn(
  tx: Exec,
  userId: number,
  hours: number,
  limit: number,
): Promise<string[]> {
  const rows = await tx.execute<{ sha256: string }>(sql`
    DELETE FROM companion_blobs AS b WHERE b.id IN (
      SELECT c.id FROM companion_blobs AS c
      WHERE c.user_id = ${userId}
        AND c.created_at < now() - make_interval(hours => ${hours})
        AND NOT EXISTS (SELECT 1 FROM companion_blob_refs AS r
                        WHERE r.user_id = c.user_id AND r.sha256 = c.sha256)
      ORDER BY c.id LIMIT ${limit})
    RETURNING b.sha256 AS "sha256"`);
  return [...rows].map((r) => r.sha256);
}

/** Users with a ref older than `days` whose blob never came (≤`limit`). */
export async function danglingRefUsers(
  db: Exec,
  days: number,
  limit: number,
): Promise<number[]> {
  const rows = await db.execute<{ userId: number }>(sql`
    SELECT DISTINCT x.user_id AS "userId" FROM companion_blob_refs AS x
    WHERE x.referenced_at < now() - make_interval(days => ${days})
      AND NOT EXISTS (SELECT 1 FROM companion_blobs AS b
                      WHERE b.user_id = x.user_id AND b.sha256 = x.sha256)
    LIMIT ${limit}`);
  return toIds(rows);
}

/** Under the user's lock: delete ≤`limit` of their dangling aged refs. */
export async function deleteDanglingRefsIn(
  tx: Exec,
  userId: number,
  days: number,
  limit: number,
): Promise<number> {
  const rows = await tx.execute<{ one: number }>(sql`
    DELETE FROM companion_blob_refs AS r
    WHERE r.user_id = ${userId} AND (r.user_id, r.sha256, r.contract) IN (
      SELECT x.user_id, x.sha256, x.contract FROM companion_blob_refs AS x
      WHERE x.user_id = ${userId}
        AND x.referenced_at < now() - make_interval(days => ${days})
        AND NOT EXISTS (SELECT 1 FROM companion_blobs AS b
                        WHERE b.user_id = x.user_id AND b.sha256 = x.sha256)
      LIMIT ${limit})
    RETURNING 1 AS one`);
  return [...rows].length;
}

/** Under the user's lock: which of `shas` still have a row. */
export async function storedShasIn(
  tx: CompanionBlobTx,
  userId: number,
  shas: readonly string[],
): Promise<Set<string>> {
  const rows = await storedBlobsIn(tx, userId, shas);
  return new Set(rows.map((r) => r.sha256));
}
