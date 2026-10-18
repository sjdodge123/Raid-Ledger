import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ValheimLinkBlobRefRow } from '../../../../drizzle/schema';
import {
  holdActiveToken,
  holdServerLock,
  type ValheimLinkTokenRef,
  type ValheimLinkTx,
} from '../valheim-link-token-lock';
import { fitsQuota, type ValheimBlobUsage } from './valheim-link-blob.quota';

/**
 * `stored` = row inserted; `exists` = pk already taken; `revoked` = token
 * died; `quota_exceeded` = the actual bytes would pass the server's caps.
 */
export type ValheimBlobInsertResult =
  | 'stored'
  | 'exists'
  | 'revoked'
  | 'quota_exceeded';

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

  /** This server's stored byte total and blob count (preflight input). */
  async usage(pelicanServerId: number): Promise<ValheimBlobUsage> {
    return usageIn(this.db, pelicanServerId);
  }

  /**
   * Insert in one transaction: hold the authenticating token (`FOR SHARE`),
   * then the server's blob advisory lock, then re-read usage and admit the
   * row only if its ACTUAL byte length fits (authoritative quota check —
   * concurrent uploads serialise here). The file rename is the caller's,
   * after commit.
   */
  async insertIfTokenActive(
    row: schema.NewValheimLinkBlob,
    token: ValheimLinkTokenRef,
  ): Promise<ValheimBlobInsertResult> {
    return this.db.transaction(async (tx) => {
      if (!(await holdActiveToken(tx, token))) return 'revoked';
      await holdServerLock(tx, 'valheim-link-blobs', row.pelicanServerId);
      if (await existsIn(tx, row.pelicanServerId, row.sha256)) return 'exists';
      const usage = await usageIn(tx, row.pelicanServerId);
      if (!fitsQuota(usage, row.byteLength)) return 'quota_exceeded';
      const written = await tx
        .insert(blobs)
        .values(row)
        .onConflictDoNothing()
        .returning({ sha256: blobs.sha256 });
      return written.length === 0 ? 'exists' : 'stored';
    });
  }

  /** Compensating delete when the post-commit rename failed. */
  async remove(pelicanServerId: number, sha256: string): Promise<void> {
    await this.db
      .delete(blobs)
      .where(
        and(
          eq(blobs.pelicanServerId, pelicanServerId),
          eq(blobs.sha256, sha256),
        ),
      );
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

async function existsIn(
  tx: ValheimLinkTx,
  pelicanServerId: number,
  sha256: string,
): Promise<boolean> {
  const rows = await tx
    .select({ sha256: blobs.sha256 })
    .from(blobs)
    .where(
      and(eq(blobs.pelicanServerId, pelicanServerId), eq(blobs.sha256, sha256)),
    )
    .limit(1);
  return rows.length > 0;
}

async function usageIn(
  db: Pick<Db, 'select'>,
  pelicanServerId: number,
): Promise<ValheimBlobUsage> {
  const [row] = await db
    .select({
      bytes: sql<string>`coalesce(sum(${blobs.byteLength}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(blobs)
    .where(eq(blobs.pelicanServerId, pelicanServerId));
  return { bytes: Number(row?.bytes ?? 0), count: Number(row?.count ?? 0) };
}
