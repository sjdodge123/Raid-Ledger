/**
 * ROK-1956 §6/§7 — `companion_blobs` + `companion_blob_refs`. Every write is
 * one statement that cannot violate a constraint (pre-checked under the
 * per-user advisory lock, or `ON CONFLICT`) — no catch-and-retry inside a
 * transaction. The cleanup deletes are raw SQL with explicit aliases so the
 * correlated `NOT EXISTS` binds to the right table.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  holdActiveDevice,
  type CompanionDeviceTx,
} from '../devices/companion-device-lock';
import type { CompanionIngestAuth } from '../ingest/companion-ingest-request';
import { companionBlobRelativePath } from './companion-blob.paths';

type Db = PostgresJsDatabase<typeof schema>;
const { companionBlobs: blobs, companionBlobRefs: refs } = schema;

/** The three facts a ref and a stored blob must agree on. */
export interface CompanionBlobDims {
  byteLength: number;
  width: number;
  height: number;
}

/** A blob identified by its owner + content hash. */
export interface CompanionBlobKey {
  userId: number;
  sha256: string;
}

/** `stored` inserted · `exists` already there · `revoked` device died · `quota_exceeded`. */
export type CompanionBlobInsertResult =
  'stored' | 'exists' | 'revoked' | 'quota_exceeded';

/** Stored blobs among `shas` for this user, inside the ingest tx (step 11b). */
export function storedBlobsIn(
  tx: Pick<Db, 'select'>,
  userId: number,
  shas: readonly string[],
): Promise<Array<CompanionBlobDims & { sha256: string }>> {
  if (shas.length === 0) return Promise.resolve([]);
  return tx
    .select({
      sha256: blobs.sha256,
      byteLength: blobs.byteLength,
      width: blobs.width,
      height: blobs.height,
    })
    .from(blobs)
    .where(and(eq(blobs.userId, userId), inArray(blobs.sha256, [...shas])));
}

/** Step 11d: record (or refresh) each ref; `refs` must be unique by sha. */
export async function upsertBlobRefsIn(
  tx: CompanionDeviceTx,
  userId: number,
  contract: string,
  rows: ReadonlyArray<CompanionBlobDims & { sha256: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insert(refs)
    .values(rows.map((r) => ({ ...r, userId, contract })))
    .onConflictDoUpdate({
      target: [refs.userId, refs.sha256, refs.contract],
      set: {
        byteLength: sql`excluded.byte_length`,
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        referencedAt: sql`now()`,
      },
    });
}

/** Blob reads/writes for the upload route, the store and the cleanup job. */
@Injectable()
export class CompanionBlobsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The stored dims for (user, sha), or null. */
  async find(userId: number, sha256: string): Promise<CompanionBlobDims | null> {
    const [row] = await storedBlobsIn(this.db, userId, [sha256]);
    return row ?? null;
  }

  /** Bytes this user already stores. */
  usage(userId: number): Promise<number> {
    return usageIn(this.db, userId);
  }

  /** Every ref (any contract) to this user's sha. */
  findRefs(userId: number, sha256: string): Promise<CompanionBlobDims[]> {
    return this.db
      .select({
        byteLength: refs.byteLength,
        width: refs.width,
        height: refs.height,
      })
      .from(refs)
      .where(and(eq(refs.userId, userId), eq(refs.sha256, sha256)));
  }

  /**
   * Step 12 in one tx: hold the device (device path), take the user's blob
   * advisory lock, then admit the row only if the ACTUAL bytes fit the quota
   * (authoritative — concurrent uploads serialise on the lock).
   */
  insert(
    auth: CompanionIngestAuth,
    row: CompanionBlobDims & { sha256: string },
    quotaBytes: number,
  ): Promise<CompanionBlobInsertResult> {
    return this.db.transaction(async (tx) => {
      if (!(await deviceHeld(tx, auth))) return 'revoked';
      const key = `companion-blobs:${auth.userId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const [stored] = await storedBlobsIn(tx, auth.userId, [row.sha256]);
      if (stored) return 'exists';
      const used = await usageIn(tx, auth.userId);
      if (used + row.byteLength > quotaBytes) return 'quota_exceeded';
      const written = await tx
        .insert(blobs)
        .values({
          ...row,
          userId: auth.userId,
          deviceId: auth.deviceId,
          storagePath: companionBlobRelativePath(auth.userId, row.sha256),
        })
        .onConflictDoNothing()
        .returning({ id: blobs.id });
      return written.length === 0 ? 'exists' : 'stored';
    });
  }

  /** Compensating delete when the post-commit rename failed. */
  async remove(userId: number, sha256: string): Promise<void> {
    await this.db
      .delete(blobs)
      .where(and(eq(blobs.userId, userId), eq(blobs.sha256, sha256)));
  }

  /** Plugin API: drop this contract's refs to `shas` (cleanup may then reap). */
  async releaseRefs(
    userId: number,
    contract: string,
    shas: readonly string[],
  ): Promise<number> {
    if (shas.length === 0) return 0;
    const result = await this.db
      .delete(refs)
      .where(
        and(
          eq(refs.userId, userId),
          eq(refs.contract, contract),
          inArray(refs.sha256, [...shas]),
        ),
      );
    return result.count;
  }

  /** Cleanup 1: delete ≤`limit` unreferenced blob rows older than `hours`. */
  async deleteUnreferencedBlobs(
    hours: number,
    limit: number,
  ): Promise<CompanionBlobKey[]> {
    const rows = await this.db.execute<{ userId: number; sha256: string }>(sql`
      DELETE FROM companion_blobs AS b WHERE b.id IN (
        SELECT c.id FROM companion_blobs AS c
        WHERE c.created_at < now() - make_interval(hours => ${hours})
          AND NOT EXISTS (SELECT 1 FROM companion_blob_refs AS r
                          WHERE r.user_id = c.user_id AND r.sha256 = c.sha256)
        ORDER BY c.id LIMIT ${limit})
      RETURNING b.user_id AS "userId", b.sha256 AS "sha256"`);
    return rows.map((r) => ({ userId: Number(r.userId), sha256: r.sha256 }));
  }

  /** Cleanup 2: delete ≤`limit` refs older than `days` whose upload never came. */
  async deleteDanglingRefs(days: number, limit: number): Promise<number> {
    const rows = await this.db.execute<{ one: number }>(sql`
      DELETE FROM companion_blob_refs AS r
      WHERE (r.user_id, r.sha256, r.contract) IN (
        SELECT x.user_id, x.sha256, x.contract FROM companion_blob_refs AS x
        WHERE x.referenced_at < now() - make_interval(days => ${days})
          AND NOT EXISTS (SELECT 1 FROM companion_blobs AS b
                          WHERE b.user_id = x.user_id AND b.sha256 = x.sha256)
        LIMIT ${limit})
      RETURNING 1 AS one`);
    return rows.length;
  }

  /** Cleanup 3 input: which of `shas` still have a row for this user. */
  async storedShas(userId: number, shas: readonly string[]): Promise<Set<string>> {
    const rows = await storedBlobsIn(this.db, userId, shas);
    return new Set(rows.map((r) => r.sha256));
  }
}

async function deviceHeld(
  tx: CompanionDeviceTx,
  auth: CompanionIngestAuth,
): Promise<boolean> {
  if (auth.via !== 'device') return true;
  const { deviceId, tokenHash } = auth;
  if (deviceId === null || tokenHash === null) return false;
  return holdActiveDevice(tx, { deviceId, tokenHash });
}

async function usageIn(
  db: Pick<Db, 'select'>,
  userId: number,
): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${blobs.byteLength}), 0)` })
    .from(blobs)
    .where(eq(blobs.userId, userId));
  return Number(row?.bytes ?? 0);
}
