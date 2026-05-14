/**
 * Tests for scheduling-api getSchedulingBanner (ROK-1235).
 *
 * Regression guard: the path must be /scheduling/banner, NOT
 * /lineups/scheduling-banner — the latter shadows LineupsController.@Get(':id')
 * and returns 400 from ParseIntPipe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fetch-api', () => ({
  fetchApi: vi.fn(),
}));

import { getSchedulingBanner } from './scheduling-api';
import { fetchApi } from './fetch-api';

const mockFetchApi = vi.mocked(fetchApi);

describe('getSchedulingBanner', () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  it('calls GET /scheduling/banner (ROK-1235 — not /lineups/scheduling-banner)', async () => {
    mockFetchApi.mockResolvedValueOnce(null);

    await getSchedulingBanner();

    expect(mockFetchApi).toHaveBeenCalledWith('/scheduling/banner');
  });

  it('returns the banner DTO from fetchApi', async () => {
    const banner = {
      lineupId: 2,
      polls: [
        {
          matchId: 1,
          gameName: 'Test',
          gameCoverUrl: null,
          memberCount: 3,
          slotCount: 0,
        },
      ],
    };
    mockFetchApi.mockResolvedValueOnce(banner);

    const result = await getSchedulingBanner();

    expect(result).toEqual(banner);
  });

  it('returns null when there is no banner', async () => {
    mockFetchApi.mockResolvedValueOnce(null);

    const result = await getSchedulingBanner();

    expect(result).toBeNull();
  });
});
