/**
 * Early access sync helpers for the ITAD price sync (ROK-934, ROK-1197).
 * Enriches games with earlyAccess status from ITAD game info.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadService } from './itad.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Per-call timeout for getGameInfo (ROK-1197). */
export const EARLY_ACCESS_CALL_TIMEOUT_MS = 8_000;

/**
 * Max in-flight `getGameInfo` calls per chunk. Keeps the burst within ITAD's
 * rate envelope: `enforceRateLimit` in itad-http.util only spaces sequential
 * callers, so unbounded concurrency would bypass it and risk 429s.
 */
export const EARLY_ACCESS_CONCURRENCY = 5;

/** Telemetry surfaced per chunk for degraded-status aggregation. */
export interface EarlyAccessChunkResult {
  updated: number;
  failed: number;
}

/** Bulk-update earlyAccess for matched games via UPDATE ... FROM VALUES. */
export async function executeBulkEarlyAccessUpdate(
  db: Db,
  rows: { id: number; earlyAccess: boolean }[],
): Promise<void> {
  const frags = rows.map((r) => sql`(${r.id}::int, ${r.earlyAccess}::boolean)`);
  await db.execute(sql`
    UPDATE ${schema.games} AS g
    SET early_access = v.ea
    FROM (VALUES ${sql.join(frags, sql`, `)}) AS v(id, ea)
    WHERE g.id = v.id
  `);
}

/**
 * Race a promise against a timeout. Rejects with `Error('timeout')` if the
 * timeout fires first. Always clears the timer to avoid leaked handles.
 */
function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Fetch earlyAccess for a chunk and bulk-update.
 *
 * Calls run with bounded concurrency (`EARLY_ACCESS_CONCURRENCY`) and a per-
 * call timeout so a single slow upstream response cannot block the chunk and
 * unbounded parallel callers don't bypass `enforceRateLimit`. Failed or
 * timed-out calls are counted in `failed` for degraded-status telemetry; a
 * successful resolution with a null payload is NOT a failure (the game just
 * isn't in ITAD).
 */
export async function enrichChunkEarlyAccess(
  db: Db,
  itadService: ItadService,
  chunk: { id: number; itadGameId: string }[],
): Promise<EarlyAccessChunkResult> {
  const updates: { id: number; earlyAccess: boolean }[] = [];
  let failed = 0;
  for (let i = 0; i < chunk.length; i += EARLY_ACCESS_CONCURRENCY) {
    const slice = chunk.slice(i, i + EARLY_ACCESS_CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((game) =>
        withTimeout(
          itadService.getGameInfo(game.itadGameId),
          EARLY_ACCESS_CALL_TIMEOUT_MS,
        ),
      ),
    );
    settled.forEach((res, j) => {
      if (res.status === 'rejected') {
        failed++;
        return;
      }
      const info = res.value;
      if (info)
        updates.push({
          id: slice[j].id,
          earlyAccess: info.earlyAccess ?? false,
        });
    });
  }

  if (updates.length > 0) {
    await executeBulkEarlyAccessUpdate(db, updates);
  }
  return { updated: updates.length, failed };
}
