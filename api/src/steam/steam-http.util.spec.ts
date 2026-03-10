/**
 * Unit tests for steam-http.util — getWishlist function (ROK-418).
 */

// Mock global fetch before imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { getWishlist, getPlayerSummary } from './steam-http.util';

afterEach(() => {
  mockFetch.mockReset();
});

describe('getWishlist', () => {
  it('returns wishlist items on success', async () => {
    const items = [
      { appid: 100, date_added: 1000 },
      { appid: 200, date_added: 2000 },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: { items } }),
    });

    const result = await getWishlist('key', '76561198000000001');

    expect(result).toEqual(items);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
    });

    const result = await getWishlist('key', '76561198000000001');

    expect(result).toEqual([]);
  });

  it('returns empty array when items is undefined', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: {} }),
    });

    const result = await getWishlist('key', '76561198000000001');

    expect(result).toEqual([]);
  });

  it('constructs URL with correct parameters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: { items: [] } }),
    });

    await getWishlist('my-api-key', '12345');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('IWishlistService/GetWishlist/v1');
    expect(calledUrl).toContain('key=my-api-key');
    expect(calledUrl).toContain('steamid=12345');
    expect(calledUrl).toContain('format=json');
  });

  it('sets User-Agent header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: { items: [] } }),
    });

    await getWishlist('key', '12345');

    const options = mockFetch.mock.calls[0][1];
    expect(options.headers['User-Agent']).toContain('RaidLedger');
  });
});

describe('getPlayerSummary', () => {
  it('returns null when response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await getPlayerSummary('key', '12345');

    expect(result).toBeNull();
  });

  it('returns null when players array is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ response: { players: [] } }),
    });

    const result = await getPlayerSummary('key', '12345');

    expect(result).toBeNull();
  });

  it('returns player summary on success', async () => {
    const player = {
      steamid: '12345',
      personaname: 'TestUser',
      profileurl: 'https://steam/id/12345',
      avatar: 'avatar.jpg',
      avatarmedium: 'avatar_m.jpg',
      avatarfull: 'avatar_f.jpg',
      communityvisibilitystate: 3,
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ response: { players: [player] } }),
    });

    const result = await getPlayerSummary('key', '12345');

    expect(result).toMatchObject({
      steamid: '12345',
      personaname: expect.any(String),
      communityvisibilitystate: 3,
    });
  });
});
