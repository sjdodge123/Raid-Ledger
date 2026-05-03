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
import { enrichChunkEarlyAccess } from './itad-early-access-sync.helpers';
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
