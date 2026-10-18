import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  holdActiveToken,
  type ValheimLinkTokenRef,
  type ValheimLinkTx,
} from '../valheim-link-token-lock';
import { admitSnapshotIn } from './valheim-link-snapshot.quota';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimLinkSnapshots: snapshots, valheimLinkBlobs: blobs } = schema;

/** Stored blob metadata a message ref is cross-checked against. */
export interface ValheimStoredBlob {
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
}

/**
 * `written` / `stale` (older or equal capturedAt) / `revoked` (token died) /
 * `quota_exceeded` (a new key past the server's snapshot caps).
 */
export type ValheimSnapshotWrite =
  | 'written'
  | 'stale'
  | 'revoked'
  | 'quota_exceeded';

/** `valheim_link_snapshots` latest-wins writes + blob lookups for ingest. */
@Injectable()
export class ValheimLinkSnapshotsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /**
   * Latest wins on `valheim_link_snapshots_key_uq`, in one transaction that
   * first holds the authenticating token (`FOR SHARE`, CONTRACT auth): a
   * rotate/revoke that landed after the guard turns the write into `revoked`.
   * Then the server's snapshot advisory lock + cap check (`admitSnapshotIn`).
   */
  async upsertLatest(
    row: schema.NewValheimLinkSnapshot,
    token: ValheimLinkTokenRef,
  ): Promise<ValheimSnapshotWrite> {
    return this.db.transaction(async (tx) => {
      if (!(await holdActiveToken(tx, token))) return 'revoked';
      if (!(await admitSnapshotIn(tx, row))) return 'quota_exceeded';
      return (await upsertIn(tx, row)) ? 'written' : 'stale';
    });
  }

  /** Blobs already stored for this server among `shas`. */
  async findBlobs(
    pelicanServerId: number,
    shas: string[],
  ): Promise<ValheimStoredBlob[]> {
    if (shas.length === 0) return [];
    return this.db
      .select({
        sha256: blobs.sha256,
        byteLength: blobs.byteLength,
        width: blobs.width,
        height: blobs.height,
      })
      .from(blobs)
      .where(
        and(
          eq(blobs.pelicanServerId, pelicanServerId),
          inArray(blobs.sha256, shas),
        ),
      );
  }
}

/**
 * Insert, or replace only when the stored `captured_at` is strictly older
 * (status back to `pending`). False when nothing was written (stale / equal).
 */
async function upsertIn(
  tx: ValheimLinkTx,
  row: schema.NewValheimLinkSnapshot,
): Promise<boolean> {
  const written = await tx
    .insert(snapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [
        snapshots.pelicanServerId,
        snapshots.kind,
        snapshots.snapshotKey,
      ],
      set: replaceSet(row),
      setWhere: sql`${snapshots.capturedAt} < excluded.captured_at`,
    })
    .returning({ id: snapshots.id });
  return written.length > 0;
}

/** Columns a newer message replaces (status back to `pending`). */
function replaceSet(
  row: schema.NewValheimLinkSnapshot,
): PgUpdateSetSource<typeof snapshots> {
  return {
    steamId: row.steamId,
    playerId: row.playerId,
    worldUid: row.worldUid,
    gameVersion: row.gameVersion,
    modVersion: row.modVersion,
    capturedAt: row.capturedAt,
    receivedAt: sql`now()`,
    payload: row.payload,
    blobRefs: row.blobRefs,
    status: 'pending',
    statusDetail: null,
  };
}
