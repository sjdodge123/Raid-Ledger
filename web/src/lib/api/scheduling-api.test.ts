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

import { getMatchAvailability, getSchedulingBanner } from './scheduling-api';
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

/**
 * ROK-1570 — the aggregate now subtracts signups/absences for a DATED week, so
 * the client must name the week the grid is painting. The server normalises the
 * instant to Sunday 00:00 UTC of its UTC week, which is why the value is the
 * local calendar Sunday at 00:00Z and not the local instant. `tzOffset` rides
 * alongside it so the server keys busy hours on the grid's wall clock.
 */
describe('getMatchAvailability (ROK-1570)', () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    mockFetchApi.mockResolvedValue({ cells: [] });
  });

  it('omits the query string when no week is given', async () => {
    await getMatchAvailability(4, 7);

    expect(mockFetchApi).toHaveBeenCalledWith('/lineups/4/schedule/7/availability');
  });

  it('appends the displayed week as an encoded ISO instant', async () => {
    const localSunday = new Date(2026, 4, 10, 0, 0, 0, 0);

    await getMatchAvailability(4, 7, localSunday);

    const url = mockFetchApi.mock.calls[0][0] as string;
    expect(url.split('?')[0]).toBe('/lineups/4/schedule/7/availability');
    expect(new URLSearchParams(url.split('?')[1]).get('weekStart')).toBe(
      '2026-05-10T00:00:00.000Z',
    );
  });

  it("sends the displayed week's tz offset so busy hours are keyed in the viewer's zone", async () => {
    // Read off the WEEK, not off `new Date()` — a DST transition between now
    // and the painted week moves the offset by an hour.
    const localSunday = new Date(2026, 4, 10, 0, 0, 0, 0);

    await getMatchAvailability(4, 7, localSunday);

    const url = mockFetchApi.mock.calls[0][0] as string;
    expect(new URLSearchParams(url.split('?')[1]).get('tzOffset')).toBe(
      String(localSunday.getTimezoneOffset()),
    );
  });

  it('sends the local calendar Sunday, not the local instant (east-of-UTC viewers)', async () => {
    const localSunday = new Date(2026, 0, 4, 0, 0, 0, 0);

    await getMatchAvailability(1, 2, localSunday);

    const url = mockFetchApi.mock.calls[0][0] as string;
    expect(new URLSearchParams(url.split('?')[1]).get('weekStart')).toBe(
      '2026-01-04T00:00:00.000Z',
    );
  });
});
