/**
 * Early access sync helpers for the ITAD price sync (ROK-934, ROK-1197).
 * Enriches games with earlyAccess status from ITAD game info.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadService } from './itad.service';
import { itadPausedUntil } from './itad-rate-limit.util';

type Db = PostgresJsDatabase<typeof schema>;

type EarlyAccessGame = { id: number; itadGameId: string };

/**
 * Per-call time budget for getGameInfo (ROK-1197). It measures the call's own
 * work, not a process-wide 429 pause: see `withCallTimeout`.
 */
export const EARLY_ACCESS_CALL_TIMEOUT_MS = 8_000;

/**
 * Max in-flight `getGameInfo` calls per slice. This does NOT set the request
 * rate: every ITAD request waits for a slot in the shared FIFO pacer
 * (itad-rate-limit.util), which starts them `ITAD_RATE_LIMIT_MS` apart
 * whatever the concurrency. It bounds how many calls queue at once, so one
 * slow upstream response only stalls its own slice.
 */
export const EARLY_ACCESS_CONCURRENCY = 5;

/** Telemetry surfaced per chunk for degraded-status aggregation. */
export interface EarlyAccessChunkResult {
  updated: number;
  failed: number;
  /** Games whose call threw or timed out; the phase retries them once. */
  failedGames: EarlyAccessGame[];
}

/** Phase totals after the tail pass; `failed` counts games that failed twice. */
export interface EarlyAccessPhaseResult {
  updated: number;
  failed: number;
  retried: number;
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
 * Race a call against its time budget; rejects with `Error('timeout')`.
 *
 * The deadline is `max(start, end of the latest ITAD 429 pause) + budgetMs`,
 * re-evaluated whenever the timer fires. A call that is legitimately waiting
 * out a `Retry-After` (up to `ITAD_RETRY_AFTER_MAX_MS`) is therefore not
 * counted as failed. A call that hangs for any other reason (slow upstream,
 * long FIFO wait) fails once it has had a full budget of its own, but it is
 * not cancelled: its request keeps retrying in the background, so the tail
 * pass can briefly overlap it with a second request for the same game.
 * Always clears the timer.
 */
function withCallTimeout<T>(p: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    const onExpiry = (): void => {
      const remaining = itadPausedUntil() + budgetMs - Date.now();
      if (remaining > 0) timer = setTimeout(onExpiry, remaining);
      else reject(new Error('timeout'));
    };
    timer = setTimeout(onExpiry, budgetMs);
  });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
}

/** Fetch game info for one slice concurrently, each under its own budget. */
function fetchSlice(itadService: ItadService, slice: EarlyAccessGame[]) {
  return Promise.allSettled(
    slice.map((game) =>
      withCallTimeout(
        // A rate-limited call must count as failed (and reach the tail
        // pass), not resolve null as if the game were missing from ITAD.
        itadService.getGameInfo(game.itadGameId, { throwOnExhausted: true }),
        EARLY_ACCESS_CALL_TIMEOUT_MS,
      ),
    ),
  );
}

/**
 * Fetch earlyAccess for a chunk and bulk-update.
 *
 * Calls run in slices of `EARLY_ACCESS_CONCURRENCY` with a per-call budget
 * so a single hung call cannot block the chunk. Failed or timed-out calls are
 * counted in `failed` (and listed in `failedGames`) for degraded-status
 * telemetry; a successful resolution with a null payload is NOT a failure
 * (the game just isn't in ITAD).
 */
export async function enrichChunkEarlyAccess(
  db: Db,
  itadService: ItadService,
  chunk: EarlyAccessGame[],
): Promise<EarlyAccessChunkResult> {
  const updates: { id: number; earlyAccess: boolean }[] = [];
  const failedGames: EarlyAccessGame[] = [];
  for (let i = 0; i < chunk.length; i += EARLY_ACCESS_CONCURRENCY) {
    const slice = chunk.slice(i, i + EARLY_ACCESS_CONCURRENCY);
    const settled = await fetchSlice(itadService, slice);
    settled.forEach((res, j) => {
      if (res.status === 'rejected') failedGames.push(slice[j]);
      else if (res.value)
        updates.push({
          id: slice[j].id,
          earlyAccess: res.value.earlyAccess ?? false,
        });
    });
  }

  if (updates.length > 0) {
    await executeBulkEarlyAccessUpdate(db, updates);
  }
  return { updated: updates.length, failed: failedGames.length, failedGames };
}

/**
 * Run every chunk, then retry the games that failed once more at the end of
 * the phase (the tail pass). By then an ITAD 429 pause has usually expired,
 * so a game that lost its call to the rate limit is enriched this run rather
 * than 4 hours later. Only games that fail both times count as failed.
 */
export async function enrichEarlyAccessPhase(
  db: Db,
  itadService: ItadService,
  chunks: EarlyAccessGame[][],
  onChunk: (size: number, result: EarlyAccessChunkResult) => void,
): Promise<EarlyAccessPhaseResult> {
  let updated = 0;
  const retry: EarlyAccessGame[] = [];
  for (const chunk of chunks) {
    const r = await enrichChunkEarlyAccess(db, itadService, chunk);
    updated += r.updated;
    retry.push(...r.failedGames);
    onChunk(chunk.length, r);
  }
  if (retry.length === 0) return { updated, failed: 0, retried: 0 };
  const tail = await enrichChunkEarlyAccess(db, itadService, retry);
  onChunk(retry.length, tail);
  return {
    updated: updated + tail.updated,
    failed: tail.failed,
    retried: retry.length,
  };
}
