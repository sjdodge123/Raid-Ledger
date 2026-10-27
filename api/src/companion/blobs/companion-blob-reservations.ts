/**
 * ROK-1956 Codex P1 — the global companion blob disk cap, enforced
 * atomically. Before a single byte is streamed an upload reserves its
 * worst case (the declared length, or the contract max when chunked). The
 * check `stored + live reservations + n <= cap` and the insert run in ONE
 * transaction under ONE global advisory lock, so concurrent uploads
 * serialise there and none can pass a stale pre-check. The reservation is
 * released only AFTER the blob row has committed (the bytes are briefly
 * counted twice — conservative, never under), and on every failure.
 *
 * Why a lock + sum and not a single-row counter: a counter must mirror
 * every delete (cleanup, stale-row repair, rename rollback) and leaks for
 * good when a process dies mid-upload. Rows here expire instead, and the
 * stored side is always the live `sum(byte_length)`.
 *
 * Lock order: this lock is taken in its own short transaction, never while
 * a device row or a user's blob lock is held, and nothing takes those while
 * holding it — so it cannot deadlock with them.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const { companionBlobs: blobs, companionBlobReservations: holds } = schema;

/** The global lock's text key (user keys are `companion-blobs:<id>`). */
export const COMPANION_BLOB_GLOBAL_LOCK_KEY = 'companion-blobs:global';

/** A reservation older than this is a crash leftover and no longer counts. */
export const COMPANION_BLOB_RESERVATION_TTL = '15 minutes';

/** Global byte reservations for in-flight companion blob uploads. */
@Injectable()
export class CompanionBlobReservations {
  private readonly logger = new Logger(CompanionBlobReservations.name);

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Reserve `bytes` if they fit under `cap`; the reservation id, else null. */
  reserve(bytes: number, cap: number): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      const key = COMPANION_BLOB_GLOBAL_LOCK_KEY;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      await tx
        .delete(holds)
        .where(
          lt(
            holds.createdAt,
            sql`now() - ${COMPANION_BLOB_RESERVATION_TTL}::interval`,
          ),
        );
      const [stored] = await tx
        .select({ n: sql<string>`coalesce(sum(${blobs.byteLength}), 0)` })
        .from(blobs);
      const [held] = await tx
        .select({ n: sql<string>`coalesce(sum(${holds.bytes}), 0)` })
        .from(holds);
      const used = Number(stored?.n ?? 0) + Number(held?.n ?? 0);
      if (used + bytes > cap) return null;
      const [row] = await tx
        .insert(holds)
        .values({ bytes })
        .returning({ id: holds.id });
      return row?.id ?? null;
    });
  }

  /** Drop a reservation. Never throws: a leaked row expires by its TTL. */
  async release(id: number): Promise<void> {
    try {
      await this.db.delete(holds).where(eq(holds.id, id));
    } catch {
      this.logger.warn(`companion blob reservation=${id} release failed`);
    }
  }
}
