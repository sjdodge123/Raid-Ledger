import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ValheimLinkBlobRefRow } from '../../../../drizzle/schema';
import {
  holdActiveToken,
  type ValheimLinkTokenRef,
} from '../valheim-link-token-lock';
import type { ValheimBlobUsage } from './valheim-link-blob.quota';

/** `stored` = row inserted; `exists` = pk already taken; `revoked` = token died. */
export type ValheimBlobInsertResult = 'stored' | 'exists' | 'revoked';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimLinkSnapshots: snapshots, valheimLinkBlobs: blobs } = schema;

/** `valheim_link_blobs` writes + the snapshot refs a blob resolves. */
@Injectable()
export class ValheimLinkBlobsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The stored row for (server, sha), or null. */
  async find(
    pelicanServerId: number,
    sha256: string,
  ): Promise<schema.ValheimLinkBlobRow | null> {
    const [row] = await this.db
      .select()
      .from(blobs)
      .where(
        and(
          eq(blobs.pelicanServerId, pelicanServerId),
          eq(blobs.sha256, sha256),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** This server's stored byte total and blob count (quota input). */
  async usage(pelicanServerId: number): Promise<ValheimBlobUsage> {
    const [row] = await this.db
      .select({
        bytes: sql<string>`coalesce(sum(${blobs.byteLength}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(blobs)
      .where(eq(blobs.pelicanServerId, pelicanServerId));
    return { bytes: Number(row?.bytes ?? 0), count: Number(row?.count ?? 0) };
  }

  /**
   * Insert in one transaction that first holds the authenticating token
   * (`FOR SHARE`); `place` (the file rename) runs only after a fresh insert,
   * inside the transaction, so a failed rename rolls the row back.
   */
  async insertIfTokenActive(
    row: schema.NewValheimLinkBlob,
    token: ValheimLinkTokenRef,
    place: () => Promise<void>,
  ): Promise<ValheimBlobInsertResult> {
    return this.db.transaction(async (tx) => {
      if (!(await holdActiveToken(tx, token))) return 'revoked';
      const written = await tx
        .insert(blobs)
        .values(row)
        .onConflictDoNothing()
        .returning({ sha256: blobs.sha256 });
      if (written.length === 0) return 'exists';
      await place();
      return 'stored';
    });
  }

  /**
   * Every ref to `sha256` on this server's snapshots
   * (`blob_refs @> '[{"sha256":…}]'`, CONTRACT §1 either-order rule).
   */
  async findRefs(
    pelicanServerId: number,
    sha256: string,
  ): Promise<ValheimLinkBlobRefRow[]> {
    const probe = JSON.stringify([{ sha256 }]);
    const rows = await this.db
      .select({ refs: snapshots.blobRefs })
      .from(snapshots)
      .where(
        and(
          eq(snapshots.pelicanServerId, pelicanServerId),
          sql`${snapshots.blobRefs} @> ${probe}::jsonb`,
        ),
      );
    return rows.flatMap((r) => r.refs.filter((ref) => ref.sha256 === sha256));
  }

  /** Stamp `last_referenced_at` (retention input; nothing is deleted here). */
  async touch(pelicanServerId: number, sha256: string): Promise<void> {
    await this.db
      .update(blobs)
      .set({ lastReferencedAt: sql`now()` })
      .where(
        and(
          eq(blobs.pelicanServerId, pelicanServerId),
          eq(blobs.sha256, sha256),
        ),
      );
  }
}
