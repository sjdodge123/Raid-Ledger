import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ValheimLinkBlobRefRow } from '../../../../drizzle/schema';

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

  /** Insert; false when a concurrent upload won the pk (row unchanged). */
  async insert(row: schema.NewValheimLinkBlob): Promise<boolean> {
    const written = await this.db
      .insert(blobs)
      .values(row)
      .onConflictDoNothing()
      .returning({ sha256: blobs.sha256 });
    return written.length > 0;
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
