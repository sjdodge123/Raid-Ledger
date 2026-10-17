/**
 * Unit tests for steam-http.util — getWishlist (ROK-418), getPlayerSummary,
 * verifySteamOpenId (ROK-1731).
 */

// Mock global fetch before imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  getWishlist,
  getPlayerSummary,
  verifySteamOpenId,
  STEAM_OPENID_URL,
} from './steam-http.util';

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
      json: () => Promise.resolve({ response: { players: [] } }),
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
      json: () => Promise.resolve({ response: { players: [player] } }),
    });

    const result = await getPlayerSummary('key', '12345');

    expect(result).toMatchObject({
      steamid: '12345',
      personaname: expect.any(String),
      communityvisibilitystate: 3,
    });
  });
});

describe('verifySteamOpenId', () => {
  const CLAIMED = 'https://steamcommunity.com/openid/id/76561198000000001';
  const query = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': CLAIMED,
    'openid.identity': CLAIMED,
    'openid.sig': 'c2ln',
    state: 'not-forwarded',
  };

  function steamReplies(body: string) {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(body),
    });
  }

  it('returns the Steam64 id when Steam answers is_valid:true', async () => {
    steamReplies('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
    await expect(verifySteamOpenId(query)).resolves.toBe('76561198000000001');
  });

  it('accepts a CRLF-terminated is_valid:true line', async () => {
    steamReplies('ns:http://specs.openid.net/auth/2.0\r\nis_valid:true\r\n');
    await expect(verifySteamOpenId(query)).resolves.toBe('76561198000000001');
  });

  it('returns null when Steam answers is_valid:false', async () => {
    steamReplies('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n');
    await expect(verifySteamOpenId(query)).resolves.toBeNull();
  });

  it('returns null when is_valid:true only appears inside another value', async () => {
    steamReplies(
      'ns:http://specs.openid.net/auth/2.0\nerror:is_valid:true\nis_valid:false\n',
    );
    await expect(verifySteamOpenId(query)).resolves.toBeNull();
  });

  it('returns null when is_valid:true has a trailing suffix', async () => {
    steamReplies('is_valid:trueish\n');
    await expect(verifySteamOpenId(query)).resolves.toBeNull();
  });

  it('returns null for a non-Steam claimed_id even if Steam says valid', async () => {
    steamReplies('is_valid:true\n');
    const forged = {
      ...query,
      'openid.claimed_id': 'https://evil.example/id/1',
    };
    await expect(verifySteamOpenId(forged)).resolves.toBeNull();
  });

  it('POSTs check_authentication with only the openid.* fields', async () => {
    steamReplies('is_valid:true\n');
    await verifySteamOpenId(query);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(STEAM_OPENID_URL);
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('openid.mode')).toBe('check_authentication');
    expect(body.get('openid.sig')).toBe('c2ln');
    expect(body.has('state')).toBe(false);
  });
});
