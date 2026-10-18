import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimLinkSnapshots: snapshots, valheimLinkBlobs: blobs } = schema;

/** Stored blob metadata a message ref is cross-checked against. */
export interface ValheimStoredBlob {
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
}

/** `valheim_link_snapshots` latest-wins writes + blob lookups for ingest. */
@Injectable()
export class ValheimLinkSnapshotsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /**
   * Latest wins on `valheim_link_snapshots_key_uq`: insert, or replace only
   * when the stored `captured_at` is strictly older (status back to
   * `pending`). Returns false when nothing was written (stale / equal).
   */
  async upsertLatest(row: schema.NewValheimLinkSnapshot): Promise<boolean> {
    const written = await this.db
      .insert(snapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [snapshots.pelicanServerId, snapshots.kind, snapshots.snapshotKey],
        set: {
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
        },
        setWhere: sql`${snapshots.capturedAt} < excluded.captured_at`,
      })
      .returning({ id: snapshots.id });
    return written.length > 0;
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
