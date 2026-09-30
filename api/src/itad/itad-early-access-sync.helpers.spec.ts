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
  EARLY_ACCESS_CALL_TIMEOUT_MS,
  enrichChunkEarlyAccess,
  enrichEarlyAccessPhase,
} from './itad-early-access-sync.helpers';
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
    expect(result).toEqual({ updated: 3, failed: 1, retried: 2 });
  });
});
