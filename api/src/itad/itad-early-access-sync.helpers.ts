/**
 * Early access sync helpers for the ITAD price sync (ROK-934, ROK-1197).
 * Enriches games with earlyAccess status from ITAD game info.
 */
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { defined } from '../common/defined.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadService } from './itad.service';
import { ItadRetriesExhaustedError } from './itad-http.util';
import { itadPausedUntil } from './itad-rate-limit.util';
import { ITAD_BACKGROUND_FETCH } from './itad.constants';

type Db = PostgresJsDatabase<typeof schema>;

const logger = new Logger('ItadEarlyAccessSync');

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

/**
 * Consecutive calls rejected with `ItadRetriesExhaustedError` after which the
 * phase stops. Once ITAD is refusing every call, finishing the run (and its
 * tail pass) only burns the rate limit the other ITAD callers share.
 */
export const EARLY_ACCESS_BREAKER_THRESHOLD = 10;

/**
 * Exhaustion streak shared by every chunk of one phase. A fulfilled call
 * resets it; timeouts and other errors leave it unchanged.
 */
export interface EarlyAccessBreaker {
  consecutive: number;
  tripped: boolean;
}

/** Telemetry surfaced per chunk for degraded-status aggregation. */
export interface EarlyAccessChunkResult {
  updated: number;
  failed: number;
  /**
   * Games whose call threw or timed out (the phase retries them once), plus
   * the games left unfetched when the breaker tripped.
   */
  failedGames: EarlyAccessGame[];
  /** The breaker tripped during this chunk, so its later slices never ran. */
  tripped: boolean;
}

/** Phase totals after the tail pass; `failed` counts games that failed twice. */
export interface EarlyAccessPhaseResult {
  updated: number;
  failed: number;
  retried: number;
  /** The breaker stopped the phase; the remaining games count as failed. */
  tripped: boolean;
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
 * Start a call with an abort signal and race it against its time budget;
 * rejects with `Error('timeout')`.
 *
 * The deadline is `max(start, end of the latest ITAD 429 pause) + budgetMs`,
 * re-evaluated whenever the timer fires. A call that is legitimately waiting
 * out a `Retry-After` (up to `ITAD_RETRY_AFTER_MAX_MS`) is therefore not
 * counted as failed. A call that hangs for any other reason (slow upstream,
 * long FIFO wait) fails once it has had a full budget of its own, and is then
 * cancelled through its signal: the in-flight request is aborted and no
 * further retry starts, so the tail pass never overlaps it with a second
 * request for the same game. Always clears the timer.
 */
function withCallTimeout<T>(
  start: (signal: AbortSignal) => Promise<T>,
  budgetMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    const onExpiry = (): void => {
      const remaining = itadPausedUntil() + budgetMs - Date.now();
      if (remaining > 0) {
        timer = setTimeout(onExpiry, remaining);
        return;
      }
      controller.abort();
      reject(new Error('timeout'));
    };
    timer = setTimeout(onExpiry, budgetMs);
  });
  return Promise.race([start(controller.signal), expired]).finally(() =>
    clearTimeout(timer),
  );
}

/** Fetch game info for one slice concurrently, each under its own budget. */
function fetchSlice(itadService: ItadService, slice: EarlyAccessGame[]) {
  return Promise.allSettled(
    slice.map((game) =>
      withCallTimeout(
        // Background (price-sync cron): waits out a 429 pause. A rate-limited
        // call must count as failed (and reach the tail pass), not resolve
        // null as if the game were missing from ITAD.
        (signal) =>
          itadService.getGameInfo(game.itadGameId, {
            ...ITAD_BACKGROUND_FETCH,
            throwOnExhausted: true,
            signal,
          }),
        EARLY_ACCESS_CALL_TIMEOUT_MS,
      ),
    ),
  );
}

type SliceOutcome = Awaited<ReturnType<typeof fetchSlice>>[number];

/** Updates and failures gathered across a chunk's slices. */
interface ChunkTally {
  updates: { id: number; earlyAccess: boolean }[];
  failedGames: EarlyAccessGame[];
}

/** Advance the exhaustion streak by one settled call; trips at the threshold. */
function countForBreaker(breaker: EarlyAccessBreaker, res: SliceOutcome) {
  if (res.status === 'fulfilled') breaker.consecutive = 0;
  else if (res.reason instanceof ItadRetriesExhaustedError) {
    breaker.consecutive += 1;
  }
  if (breaker.consecutive >= EARLY_ACCESS_BREAKER_THRESHOLD) {
    breaker.tripped = true;
  }
}

/** Record one slice's settled calls (in slice order) into the chunk tally. */
function tallySlice(
  slice: EarlyAccessGame[],
  settled: SliceOutcome[],
  tally: ChunkTally,
  breaker: EarlyAccessBreaker | undefined,
): void {
  settled.forEach((res, j) => {
    // allSettled keeps order and length, so `j` always indexes `slice`.
    const game = defined(slice[j], 'early-access slice game');
    if (res.status === 'rejected') tally.failedGames.push(game);
    else if (res.value)
      tally.updates.push({
        id: game.id,
        earlyAccess: res.value.earlyAccess ?? false,
      });
    if (breaker) countForBreaker(breaker, res);
  });
}

/**
 * Fetch earlyAccess for a chunk and bulk-update.
 *
 * Calls run in slices of `EARLY_ACCESS_CONCURRENCY` with a per-call budget
 * so a single hung call cannot block the chunk. Failed or timed-out calls are
 * counted in `failed` (and listed in `failedGames`) for degraded-status
 * telemetry; a successful resolution with a null payload is NOT a failure
 * (the game just isn't in ITAD).
 *
 * With a `breaker` (the phase passes one), a trip stops the chunk's remaining
 * slices: the updates already gathered are still written, and the unfetched
 * games join `failedGames`. A direct call without one never trips.
 */
export async function enrichChunkEarlyAccess(
  db: Db,
  itadService: ItadService,
  chunk: EarlyAccessGame[],
  breaker?: EarlyAccessBreaker,
): Promise<EarlyAccessChunkResult> {
  const tally: ChunkTally = { updates: [], failedGames: [] };
  let next = 0;
  while (next < chunk.length && !breaker?.tripped) {
    const slice = chunk.slice(next, next + EARLY_ACCESS_CONCURRENCY);
    tallySlice(slice, await fetchSlice(itadService, slice), tally, breaker);
    next += slice.length;
  }
  const tripped = breaker?.tripped ?? false;
  if (tripped) tally.failedGames.push(...chunk.slice(next));

  if (tally.updates.length > 0) {
    await executeBulkEarlyAccessUpdate(db, tally.updates);
  }
  const { failedGames } = tally;
  return {
    updated: tally.updates.length,
    failed: failedGames.length,
    failedGames,
    tripped,
  };
}

/** Where the breaker tripped, as worded in the warning. */
type TripPoint = 'tail pass skipped' | 'during the tail pass';

/** Warn that the breaker stopped the phase, with how many games it left. */
function logTrip(unenriched: number, where: TripPoint): void {
  logger.warn(
    `ITAD earlyAccess phase stopped after ${EARLY_ACCESS_BREAKER_THRESHOLD} consecutive exhausted calls; ${unenriched} games skipped or failed (${where})`,
  );
}

/** Phase result once the breaker trips during the first pass. */
function trippedPhase(
  updated: number,
  failedSoFar: number,
  remaining: EarlyAccessGame[][],
): EarlyAccessPhaseResult {
  const failed = remaining.reduce((n, c) => n + c.length, failedSoFar);
  logTrip(failed, 'tail pass skipped');
  return { updated, failed, retried: 0, tripped: true };
}

/**
 * Run every chunk, then retry the games that failed once more at the end of
 * the phase (the tail pass). By then an ITAD 429 pause has usually expired,
 * so a game that lost its call to the rate limit is enriched this run rather
 * than 4 hours later. Only games that fail both times count as failed.
 *
 * After `EARLY_ACCESS_BREAKER_THRESHOLD` consecutive exhausted calls the
 * phase stops: no further chunk, no tail pass, and every game it did not
 * enrich counts as failed (so the run reports degraded).
 */
export async function enrichEarlyAccessPhase(
  db: Db,
  itadService: ItadService,
  chunks: EarlyAccessGame[][],
  onChunk: (size: number, result: EarlyAccessChunkResult) => void,
): Promise<EarlyAccessPhaseResult> {
  const breaker: EarlyAccessBreaker = { consecutive: 0, tripped: false };
  let updated = 0;
  const retry: EarlyAccessGame[] = [];
  for (const [n, chunk] of chunks.entries()) {
    const r = await enrichChunkEarlyAccess(db, itadService, chunk, breaker);
    updated += r.updated;
    retry.push(...r.failedGames);
    onChunk(chunk.length, r);
    if (r.tripped)
      return trippedPhase(updated, retry.length, chunks.slice(n + 1));
  }
  if (retry.length === 0) {
    return { updated, failed: 0, retried: 0, tripped: false };
  }
  const tail = await enrichChunkEarlyAccess(db, itadService, retry, breaker);
  onChunk(retry.length, tail);
  if (tail.tripped) logTrip(tail.failed, 'during the tail pass');
  return {
    updated: updated + tail.updated,
    failed: tail.failed,
    retried: retry.length,
    tripped: tail.tripped,
  };
}
