/**
 * ROK-1956 §6/§7 — `companion_blobs` + `companion_blob_refs`. Every write is
 * one statement that cannot violate a constraint (pre-checked under the
 * per-user advisory lock, or `ON CONFLICT`) — no catch-and-retry inside a
 * transaction. The cleanup deletes are raw SQL with explicit aliases so the
 * correlated `NOT EXISTS` binds to the right table.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  holdActiveDevice,
  type CompanionDeviceTx,
} from '../devices/companion-device-lock';
import type { CompanionIngestAuth } from '../ingest/companion-ingest-request';
import { lockCompanionUserBlobs } from './companion-blob-lock';
import {
  companionBlobFileExists,
  companionBlobRelativePath,
} from './companion-blob.paths';
import { refsAgree } from './companion-blob-refs.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const { companionBlobs: blobs, companionBlobRefs: refs } = schema;

/**
 * A row without its file is only treated as stale once it is this old;
 * younger, it may be an upload still between its commit and its rename.
 */
export const COMPANION_BLOB_STALE_ROW_MIN_AGE = '5 minutes';

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

/** `stored` · `exists` · `revoked` device died · `quota_exceeded` · `ref_mismatch` (re-read under the lock). */
export type CompanionBlobInsertResult =
  'stored' | 'exists' | 'revoked' | 'quota_exceeded' | 'ref_mismatch';

/** The transaction handle the cleanup phases run in. */
export type CompanionBlobTx = Parameters<Parameters<Db['transaction']>[0]>[0];

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

  /** Lock-free raw-SQL reads (the cleanup's candidate queries). */
  get reader(): Pick<Db, 'execute'> {
    return this.db;
  }

  /** The stored dims for (user, sha), or null. */
  async find(
    userId: number,
    sha256: string,
  ): Promise<CompanionBlobDims | null> {
    const [row] = await storedBlobsIn(this.db, userId, [sha256]);
    return row ?? null;
  }

  /** Bytes this user already stores. */
  usage(userId: number): Promise<number> {
    return usageIn(this.db, userId);
  }

  /** Bytes stored across every user (the global disk cap's pre-check). */
  async totalUsage(): Promise<number> {
    const [row] = await this.db
      .select({ bytes: sql<string>`coalesce(sum(${blobs.byteLength}), 0)` })
      .from(blobs);
    return Number(row?.bytes ?? 0);
  }

  /** Every ref (any contract) to this user's sha (fast-fail pre-check). */
  findRefs(userId: number, sha256: string): Promise<CompanionBlobDims[]> {
    return findRefsIn(this.db, userId, sha256);
  }

  /** Run `fn` in one transaction holding the user's blob lock. */
  withUserLock<T>(
    userId: number,
    fn: (tx: CompanionBlobTx) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await lockCompanionUserBlobs(tx, userId);
      return fn(tx);
    });
  }

  /**
   * Drop a row whose file is gone so a re-upload restores it. Under the lock
   * the file is checked AGAIN and only a row older than
   * `COMPANION_BLOB_STALE_ROW_MIN_AGE` goes: a younger one may be a
   * concurrent same-sha upload between its commit and its rename. True when
   * the row was deleted.
   */
  removeStale(userId: number, sha256: string): Promise<boolean> {
    return this.withUserLock(userId, async (tx) => {
      if (await companionBlobFileExists(userId, sha256)) return false;
      const gone = await tx
        .delete(blobs)
        .where(
          and(
            eq(blobs.userId, userId),
            eq(blobs.sha256, sha256),
            lt(
              blobs.createdAt,
              sql`now() - ${COMPANION_BLOB_STALE_ROW_MIN_AGE}::interval`,
            ),
          ),
        )
        .returning({ id: blobs.id });
      return gone.length > 0;
    });
  }

  /**
   * Step 12 in one tx: hold the device (device path), take the user's blob
   * advisory lock, re-read the refs (a message may have committed one since
   * the pre-check), then admit the row only if the ACTUAL bytes fit the
   * quota (authoritative — concurrent uploads serialise on the lock).
   */
  insert(
    auth: CompanionIngestAuth,
    row: CompanionBlobDims & { sha256: string },
    quotaBytes: number,
  ): Promise<CompanionBlobInsertResult> {
    return this.db.transaction(async (tx) => {
      if (!(await deviceHeld(tx, auth))) return 'revoked';
      await lockCompanionUserBlobs(tx, auth.userId);
      const [stored] = await storedBlobsIn(tx, auth.userId, [row.sha256]);
      if (stored) return 'exists';
      if (!refsAgree(await findRefsIn(tx, auth.userId, row.sha256), row)) {
        return 'ref_mismatch';
      }
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

  /** Compensating delete when the post-commit rename failed (under the lock). */
  async remove(userId: number, sha256: string): Promise<void> {
    await this.withUserLock(userId, async (tx) => {
      await tx
        .delete(blobs)
        .where(and(eq(blobs.userId, userId), eq(blobs.sha256, sha256)));
    });
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

function findRefsIn(
  db: Pick<Db, 'select'>,
  userId: number,
  sha256: string,
): Promise<CompanionBlobDims[]> {
  return db
    .select({
      byteLength: refs.byteLength,
      width: refs.width,
      height: refs.height,
    })
    .from(refs)
    .where(and(eq(refs.userId, userId), eq(refs.sha256, sha256)));
}
