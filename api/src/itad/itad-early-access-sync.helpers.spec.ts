/**
 * Tests for itad-early-access-sync.helpers (ROK-1197).
 *
 * Failing TDD tests for the per-call timeout / bounded-concurrency rewrite of
 * `enrichChunkEarlyAccess`. Today the helper:
 *   - calls `itadService.getGameInfo` sequentially,
 *   - has no per-call timeout,
 *   - silently swallows errors (no failure telemetry).
 *
 * After the fix, a single hung call must not be able to block the whole chunk
 * for >10s, and the helper must surface per-chunk telemetry the caller can
 * aggregate into a degraded-status signal (AC #5).
 */
import {
  EARLY_ACCESS_BREAKER_THRESHOLD,
  EARLY_ACCESS_CALL_TIMEOUT_MS,
  enrichChunkEarlyAccess,
  enrichEarlyAccessPhase,
} from './itad-early-access-sync.helpers';
import { ItadRetriesExhaustedError } from './itad-http.util';
import { ITAD_BACKGROUND_FETCH } from './itad.constants';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

type ItadServiceLike = {
  getGameInfo: jest.Mock;
};

function buildItadService(): ItadServiceLike {
  return { getGameInfo: jest.fn() };
}

function buildChunk(size: number): { id: number; itadGameId: string }[] {
  return Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    itadGameId: `game-uuid-${i + 1}`,
  }));
}

describe('enrichChunkEarlyAccess — per-call timeout (ROK-1197)', () => {
  let mockDb: MockDb;
  let itadService: ItadServiceLike;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    itadService = buildItadService();
  });

  it('completes within ~10s even when one getGameInfo call hangs forever', async () => {
    const chunk = buildChunk(10);

    // First call hangs forever; remaining 9 resolve immediately
    itadService.getGameInfo.mockImplementation((id: string) => {
      if (id === 'game-uuid-1') {
        return new Promise(() => {
          /* never resolves */
        });
      }
      return Promise.resolve({ earlyAccess: false });
    });

    const startedAt = Date.now();
    const result = (await enrichChunkEarlyAccess(
      mockDb as never,
      itadService as never,
      chunk,
    )) as unknown;
    const elapsedMs = Date.now() - startedAt;

    // Must return — and must do so well under the Jest test timeout
    // budget set on this test (12s) so the helper has some margin.
    expect(elapsedMs).toBeLessThan(11_000);
    // Helper must surface per-chunk telemetry so the service can flag
    // degraded runs. Today it returns a bare number, which fails this check.
    expect(typeof result).toBe('object');
    expect(result).toMatchObject({
      updated: expect.any(Number),
      failed: expect.any(Number),
    });
    // The hung call must be counted as a failure, not silently dropped.
    expect((result as { failed: number }).failed).toBeGreaterThanOrEqual(1);
  }, 12_000);

  it('counts a rate-limited (retries exhausted) call as failed, not as "not in ITAD"', async () => {
    // Mirrors ItadService.getGameInfo: rejects only when asked to, otherwise
    // an exhausted call resolves null exactly like a game ITAD doesn't know.
    itadService.getGameInfo.mockImplementation(
      (_id: string, opts?: { throwOnExhausted?: boolean }) =>
        opts?.throwOnExhausted
          ? Promise.reject(new ItadRetriesExhaustedError('/games/info/v2'))
          : Promise.resolve(null),
    );

    const result = await enrichChunkEarlyAccess(
      mockDb as never,
      itadService as never,
      buildChunk(2),
    );

    expect(result).toMatchObject({ updated: 0, failed: 2 });
  });

  it('fetches with the background ITAD wait (cron), still rejecting on exhaustion', async () => {
    itadService.getGameInfo.mockResolvedValue({ earlyAccess: true });

    await enrichChunkEarlyAccess(
      mockDb as never,
      itadService as never,
      buildChunk(1),
    );

    expect(itadService.getGameInfo).toHaveBeenCalledWith(expect.any(String), {
      ...ITAD_BACKGROUND_FETCH,
      throwOnExhausted: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('counts thrown getGameInfo errors in the failed counter', async () => {
    const chunk = buildChunk(4);
    itadService.getGameInfo
      .mockResolvedValueOnce({ earlyAccess: true })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ earlyAccess: false })
      .mockRejectedValueOnce(new Error('boom-2'));

    const result = (await enrichChunkEarlyAccess(
      mockDb as never,
      itadService as never,
      chunk,
    )) as unknown;

    expect(typeof result).toBe('object');
    expect(result).toMatchObject({
      updated: 2,
      failed: 2,
    });
  });
});

describe('enrichChunkEarlyAccess — call budget vs an ITAD 429 pause', () => {
  // Fresh module registry per test: the pacer's pause state is module-global.
  type Helpers = typeof import('./itad-early-access-sync.helpers');
  type RateLimit = typeof import('./itad-rate-limit.util');
  const T0 = Date.UTC(2020, 0, 1);
  let helpers: Helpers;
  let rateLimit: RateLimit;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    jest.isolateModules(() => {
      rateLimit = jest.requireActual<RateLimit>('./itad-rate-limit.util');
      helpers = jest.requireActual<Helpers>('./itad-early-access-sync.helpers');
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** getGameInfo that hits a 429 (pausing ITAD) then resolves later, or never. */
  function pausedCall(pauseMs: number, resolveAfterMs: number | null) {
    return jest.fn(() => {
      rateLimit.pauseItadRequests(pauseMs);
      return new Promise((resolve) => {
        if (resolveAfterMs === null) return;
        setTimeout(() => resolve({ earlyAccess: true }), resolveAfterMs);
      });
    });
  }

  it('does not fail a call that is waiting out a Retry-After longer than its budget', async () => {
    const itadService = { getGameInfo: pausedCall(30_000, 31_000) };
    const pending = helpers.enrichChunkEarlyAccess(
      createDrizzleMock() as never,
      itadService as never,
      buildChunk(1),
    );

    await jest.advanceTimersByTimeAsync(31_000);

    await expect(pending).resolves.toMatchObject({ updated: 1, failed: 0 });
  });

  it('still fails a hung call once it has had a full budget after the pause ends', async () => {
    const itadService = { getGameInfo: pausedCall(10_000, null) };
    let settled = false;
    const pending = helpers
      .enrichChunkEarlyAccess(
        createDrizzleMock() as never,
        itadService as never,
        buildChunk(1),
      )
      .finally(() => {
        settled = true;
      });

    await jest.advanceTimersByTimeAsync(
      10_000 + EARLY_ACCESS_CALL_TIMEOUT_MS - 1,
    );
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({ updated: 0, failed: 1 });
  });
});

describe('enrichChunkEarlyAccess — timed-out call is cancelled', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.UTC(2020, 0, 1) });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts a timed-out call so it stops retrying in the background', async () => {
    let signal: AbortSignal | undefined;
    const getGameInfo = jest.fn(
      (_id: string, opts: { signal?: AbortSignal }) => {
        signal = opts.signal;
        return new Promise(() => {
          /* never resolves */
        });
      },
    );
    const pending = enrichChunkEarlyAccess(
      createDrizzleMock() as never,
      { getGameInfo } as never,
      buildChunk(1),
    );

    await jest.advanceTimersByTimeAsync(EARLY_ACCESS_CALL_TIMEOUT_MS + 1);

    await expect(pending).resolves.toMatchObject({ updated: 0, failed: 1 });
    expect(signal?.aborted).toBe(true);
  });
});

describe('enrichEarlyAccessPhase — tail pass', () => {
  it('retries failed games once at the end and only counts double failures', async () => {
    const itadService = buildItadService();
    const seen = new Set<string>();
    itadService.getGameInfo.mockImplementation((id: string) => {
      const first = !seen.has(id);
      seen.add(id);
      if (id === 'game-uuid-4') return Promise.reject(new Error('down'));
      if (id === 'game-uuid-2' && first)
        return Promise.reject(new Error('429'));
      return Promise.resolve({ earlyAccess: true });
    });
    const chunk = buildChunk(4);

    const result = await enrichEarlyAccessPhase(
      createDrizzleMock() as never,
      itadService as never,
      [chunk.slice(0, 2), chunk.slice(2)],
      () => undefined,
    );

    const calledIds = itadService.getGameInfo.mock.calls.map((c) => c[0]);
    expect(calledIds).toEqual([
      'game-uuid-1',
      'game-uuid-2',
      'game-uuid-3',
      'game-uuid-4',
      'game-uuid-2',
      'game-uuid-4',
    ]);
    expect(result).toEqual({
      updated: 3,
      failed: 1,
      retried: 2,
      tripped: false,
    });
  });
});

const exhausted = () =>
  Promise.reject(new ItadRetriesExhaustedError('/games/info/v2'));

/** The game number from a `game-uuid-N` id. */
const gameNo = (id: string) => Number(id.slice('game-uuid-'.length));

describe('enrichEarlyAccessPhase — consecutive-exhaustion breaker trips', () => {
  it('stops after 10 consecutive exhausted calls: no later chunk, no tail pass', async () => {
    expect(EARLY_ACCESS_BREAKER_THRESHOLD).toBe(10);
    const itadService = buildItadService();
    itadService.getGameInfo.mockImplementation(exhausted);
    const games = buildChunk(20);
    const onChunk = jest.fn();

    const result = await enrichEarlyAccessPhase(
      createDrizzleMock() as never,
      itadService as never,
      [games.slice(0, 12), games.slice(12)],
      onChunk,
    );

    // Two slices of EARLY_ACCESS_CONCURRENCY (5), then the breaker stops.
    expect(itadService.getGameInfo).toHaveBeenCalledTimes(10);
    expect(result).toEqual({
      updated: 0,
      failed: 20,
      retried: 0,
      tripped: true,
    });
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ updated: 0, failed: 12, tripped: true }),
    );
  });

  it('still writes the updates gathered before the trip', async () => {
    const db = createDrizzleMock();
    const itadService = buildItadService();
    itadService.getGameInfo.mockImplementation((id: string) =>
      gameNo(id) <= 2 ? Promise.resolve({ earlyAccess: true }) : exhausted(),
    );

    const result = await enrichEarlyAccessPhase(
      db as never,
      itadService as never,
      [buildChunk(17)],
      () => undefined,
    );

    // Games 3-12 make ten in a row; 13-15 share that slice; 16-17 never run.
    expect(itadService.getGameInfo).toHaveBeenCalledTimes(15);
    expect(result).toEqual({
      updated: 2,
      failed: 15,
      retried: 0,
      tripped: true,
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe('enrichEarlyAccessPhase — consecutive-exhaustion streak', () => {
  it('a fulfilled call resets the streak, so interleaved successes never trip it', async () => {
    const itadService = buildItadService();
    const seen = new Set<string>();
    itadService.getGameInfo.mockImplementation((id: string) => {
      const first = !seen.has(id);
      seen.add(id);
      // First pass: nine exhausted calls between each success.
      if (first && gameNo(id) % 10 !== 0) return exhausted();
      return Promise.resolve({ earlyAccess: false });
    });

    const result = await enrichEarlyAccessPhase(
      createDrizzleMock() as never,
      itadService as never,
      [buildChunk(20)],
      () => undefined,
    );

    expect(itadService.getGameInfo).toHaveBeenCalledTimes(38);
    expect(result).toEqual({
      updated: 20,
      failed: 0,
      retried: 18,
      tripped: false,
    });
  });

  it('timeouts and other errors neither count toward nor reset the streak', async () => {
    const itadService = buildItadService();
    // Games 1-5 and 11-15 exhausted; 6-10 fail some other way.
    itadService.getGameInfo.mockImplementation((id: string) => {
      const n = gameNo(id);
      if (n > 5 && n <= 10) return Promise.reject(new Error('timeout'));
      return exhausted();
    });

    const result = await enrichEarlyAccessPhase(
      createDrizzleMock() as never,
      itadService as never,
      [buildChunk(20)],
      () => undefined,
    );

    expect(itadService.getGameInfo).toHaveBeenCalledTimes(15);
    expect(result).toEqual({
      updated: 0,
      failed: 20,
      retried: 0,
      tripped: true,
    });
  });
});
