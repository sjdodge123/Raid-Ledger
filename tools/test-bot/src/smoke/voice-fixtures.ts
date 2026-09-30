/**
 * Voice-activity smoke fixtures.
 *
 * Lives outside `tests/voice-activity.test.ts` because that file is pinned
 * over its line cap (TECH-DEBT-BACKLOG 2026-09-07) and must not grow.
 *
 * Pure apart from the API client it is handed — the unit spec drives it with
 * a stub (`voice-fixtures.spec.ts`).
 */
import { pollForCondition } from '../helpers/polling.js';
import type { ApiClient } from './api.js';

export const NO_MONITOR_GAME =
  'fixture precondition: no game in DB for game-voice-monitor binding';

/** The slice of TestContext the game lookup needs. */
export interface MonitorGameSource {
  games: { id: number }[];
  api: Pick<ApiClient, 'get'>;
}

/**
 * The game a `game-voice-monitor` binding is created with.
 *
 * `ctx.games` is derived from the demo events (demo-data.ts) and can be
 * empty; a monitor binding with no game is rejected with a 400 (ROK-1415).
 * Fall back to the first game in the DB, and name the missing precondition
 * when there is none — never hand `undefined` to the binding.
 */
export async function resolveMonitorGameId(
  ctx: MonitorGameSource,
): Promise<number> {
  const fromDemo = ctx.games[0]?.id;
  if (fromDemo) return fromDemo;
  const res = await ctx.api.get<{ data?: { id: number }[] } | null>(
    '/admin/settings/games?limit=1',
  );
  const fromDb = res?.data?.[0]?.id;
  if (fromDb) return fromDb;
  throw new Error(NO_MONITOR_GAME);
}

/** The metrics fields that show classification has landed. */
export interface ClassifiedMetricsShape {
  attendanceSummary: { attended: number } | null;
  voiceSummary: unknown;
}

/** True once classification has written attendance AND the voice summary. */
export function isClassified(
  m: ClassifiedMetricsShape | null | undefined,
): boolean {
  return !!m && (m.attendanceSummary?.attended ?? 0) > 0 && m.voiceSummary != null;
}

export interface MetricsPollSource {
  api: Pick<ApiClient, 'get'>;
  config: { timeoutMs: number };
}

/**
 * Read `/events/:id/metrics` until classification is visible, bounded by
 * `ctx.config.timeoutMs`. `await-processing` returning does not guarantee
 * the classify writes are readable yet, so a single read raced them.
 *
 * On timeout this returns the LAST read instead of throwing, so the caller's
 * own assertions fail naming expected vs actual rather than "timed out". A
 * failed read (non-2xx) still propagates.
 */
export async function pollClassifiedMetrics<M extends ClassifiedMetricsShape>(
  ctx: MetricsPollSource,
  eventId: number,
  intervalMs = 1000,
): Promise<M> {
  const path = `/events/${eventId}/metrics`;
  let last: M | undefined;
  let readErr: unknown;
  const check = async (): Promise<M | null> => {
    try {
      last = await ctx.api.get<M>(path);
    } catch (err) {
      readErr = err;
      throw err;
    }
    return isClassified(last) ? last : null;
  };
  try {
    return await pollForCondition(check, ctx.config.timeoutMs, { intervalMs });
  } catch (err) {
    if (err === readErr || last === undefined) throw err;
    console.warn(
      `  [voice] ${path} not classified within ${ctx.config.timeoutMs}ms — asserting on the last read`,
    );
    return last;
  }
}

/**
 * `awaitProcessing` that logs what the drain returned and how long it took,
 * so a metrics mismatch after it can be told apart from a slow drain.
 */
export async function awaitProcessingLogged(
  api: Pick<ApiClient, 'post'>,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  try {
    const body = await api.post('/admin/test/await-processing', { timeoutMs });
    console.log(
      `  [${label}] await-processing settled in ${Date.now() - started}ms: ${JSON.stringify(body)}`,
    );
  } catch (err) {
    console.log(
      `  [${label}] await-processing failed after ${Date.now() - started}ms: ${(err as Error).message}`,
    );
    throw err;
  }
}
