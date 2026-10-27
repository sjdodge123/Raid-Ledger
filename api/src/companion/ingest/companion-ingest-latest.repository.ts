/**
 * ROK-1956 §4.2 — the ingest transaction and core latest-wins state
 * (`companion_ingest_latest`, per user, D-11..D-13).
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  holdActiveDevice,
  type CompanionDeviceTx,
} from '../devices/companion-device-lock';
import { lockCompanionUserBlobs } from '../blobs/companion-blob-lock';
import type { CompanionBlobRefRow } from '../blobs/companion-blob-refs.helpers';
import {
  storedBlobsIn,
  upsertBlobRefsIn,
} from '../blobs/companion-blobs.repository';

type Db = PostgresJsDatabase<typeof schema>;
const latest = schema.companionIngestLatest;

/** One latest-wins compare-and-set. */
export interface CompanionLatestAdvance {
  userId: number;
  contract: string;
  key: string;
  at: Date;
}

/** Transaction + latest-wins writes for the messages route. */
@Injectable()
export class CompanionIngestLatestRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Run `fn` in one transaction (a throw rolls everything back). */
  transaction<T>(fn: (tx: CompanionDeviceTx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  /** Step 11a: share-lock the device row; false once revoked/rotated. */
  holdDevice(
    tx: CompanionDeviceTx,
    auth: { deviceId: number; tokenHash: string },
  ): Promise<boolean> {
    return holdActiveDevice(tx, auth);
  }

  /**
   * Step 11c: one statement that cannot violate the PK — insert the marker,
   * or move it forward only when `at` is strictly newer. A row back = this
   * message is the latest; none = `stale` (older or equal `at`).
   */
  async advance(
    tx: CompanionDeviceTx,
    row: CompanionLatestAdvance,
  ): Promise<boolean> {
    const written = await tx
      .insert(latest)
      .values({
        userId: row.userId,
        contract: row.contract,
        latestKey: row.key,
        latestAt: row.at,
      })
      .onConflictDoUpdate({
        target: [latest.userId, latest.contract, latest.latestKey],
        set: { latestAt: sql`excluded.latest_at`, updatedAt: sql`now()` },
        setWhere: sql`${latest.latestAt} < excluded.latest_at`,
      })
      .returning({ userId: latest.userId });
    return written.length > 0;
  }

  /** Step 11b input: this user's stored blobs among `shas`. */
  storedBlobs(
    tx: CompanionDeviceTx,
    userId: number,
    shas: readonly string[],
  ): Promise<CompanionBlobRefRow[]> {
    return storedBlobsIn(tx, userId, shas);
  }

  /** The shared per-user blob lock (before 11b reads, until the tx ends). */
  lockUserBlobs(tx: CompanionDeviceTx, userId: number): Promise<void> {
    return lockCompanionUserBlobs(tx, userId);
  }

  /** Step 11d: upsert `companion_blob_refs` (rows unique by sha). */
  recordBlobRefs(
    tx: CompanionDeviceTx,
    userId: number,
    contract: string,
    rows: readonly CompanionBlobRefRow[],
  ): Promise<void> {
    return upsertBlobRefsIn(tx, userId, contract, rows);
  }
}
