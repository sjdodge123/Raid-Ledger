/**
 * ROK-1953 U1–U6 — Steam achievement fetchers. Fixtures are UNVERIFIED
 * (built from documented shapes; see testing/steam-achievements.fixtures.ts).
 */
const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  getGlobalAchievementPercentages,
  getPlayerAchievements,
  getSchemaForGame,
} from './steam-achievements-http.util';
import * as fx from './testing/steam-achievements.fixtures';

function respond(status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  });
}

const player = () =>
  getPlayerAchievements('k3y', fx.FAKE_STEAM_ID, fx.BG3_APP_ID);

afterEach(() => mockFetch.mockReset());

describe('getPlayerAchievements', () => {
  it('U1: keeps only achieved===1 and converts unlock seconds to a Date', async () => {
    respond(200, fx.PLAYER_ACHIEVEMENTS_OK);
    expect(await player()).toEqual({
      kind: 'ok',
      unlocked: [
        { apiName: 'ACH_FIRST_STEPS', unlockedAt: new Date(1729800000 * 1000) },
        { apiName: 'ACH_ANCIENT', unlockedAt: null },
      ],
    });
  });

  it('U1: a game with stats but no achievements is ok with nothing unlocked', async () => {
    respond(200, fx.PLAYER_ACHIEVEMENTS_NONE);
    expect(await player()).toEqual({ kind: 'ok', unlocked: [] });
  });

  it('calls GetPlayerAchievements/v1 for the steam id and app', async () => {
    respond(200, fx.PLAYER_ACHIEVEMENTS_NONE);
    await player();
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/ISteamUserStats/GetPlayerAchievements/v1/');
    expect(url.searchParams.get('steamid')).toBe(fx.FAKE_STEAM_ID);
    expect(url.searchParams.get('appid')).toBe(String(fx.BG3_APP_ID));
    expect(url.searchParams.get('key')).toBe('k3y');
  });

  it('U2: 403 "Profile is not public" is private', async () => {
    respond(403, fx.PLAYER_ACHIEVEMENTS_PRIVATE);
    expect(await player()).toEqual({ kind: 'private' });
  });

  it('U3: 400 "Requested app has no stats" is not_owned', async () => {
    respond(400, fx.PLAYER_ACHIEVEMENTS_NOT_OWNED);
    expect(await player()).toEqual({ kind: 'not_owned' });
  });

  it('U4: 429 is rate_limited', async () => {
    respond(429, '');
    expect(await player()).toEqual({ kind: 'rate_limited' });
  });

  it('U4: a 502 HTML page is an error, never private', async () => {
    respond(502, fx.STEAM_BAD_GATEWAY_HTML);
    expect(await player()).toEqual({ kind: 'error', status: 502 });
  });

  it('U4: a bare 403 without the not-public body is an error, never private', async () => {
    respond(403, 'Forbidden');
    expect(await player()).toEqual({ kind: 'error', status: 403 });
  });

  it('a network failure or timeout is an error with status 0', async () => {
    mockFetch.mockRejectedValueOnce(new Error('The operation was aborted'));
    expect(await player()).toEqual({ kind: 'error', status: 0 });
  });
});

describe('getSchemaForGame', () => {
  it('U5: maps hidden 0/1 to booleans and a blank or absent description to null', async () => {
    respond(200, fx.SCHEMA_OK);
    const result = await getSchemaForGame('k3y', fx.BG3_APP_ID);
    expect(result).toEqual({
      kind: 'ok',
      missingHidden: 0,
      achievements: [
        {
          apiName: 'ACH_FIRST_STEPS',
          name: 'First Steps',
          description: 'Leave the nautiloid.',
          icon: 'https://cdn.example.invalid/first.jpg',
          hidden: false,
        },
        {
          apiName: 'ACH_SECRET',
          name: 'A Secret Ending',
          description: null,
          icon: 'https://cdn.example.invalid/secret.jpg',
          hidden: true,
        },
        {
          apiName: 'ACH_NO_DESC',
          name: 'Quiet One',
          description: null,
          icon: null,
          hidden: true,
        },
      ],
    });
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/ISteamUserStats/GetSchemaForGame/v2/');
    expect(url.searchParams.get('l')).toBe('english');
  });

  it('U5: a game with no achievements is an empty list', async () => {
    respond(200, fx.SCHEMA_NO_ACHIEVEMENTS);
    expect(await getSchemaForGame('k3y', 1)).toEqual({
      kind: 'ok',
      missingHidden: 0,
      achievements: [],
    });
  });

  it('OQ5: an entry without hidden fails closed (hidden) and is counted', async () => {
    respond(200, fx.SCHEMA_MISSING_HIDDEN);
    const result = await getSchemaForGame('k3y', 1);
    expect(result).toEqual({
      kind: 'ok',
      missingHidden: 1,
      achievements: [
        {
          apiName: 'ACH_UNKNOWN',
          name: 'Unknown',
          description: 'x',
          icon: null,
          hidden: true,
        },
      ],
    });
  });

  it('a 429 is rate_limited and a 500 is an error', async () => {
    respond(429, '');
    expect(await getSchemaForGame('k3y', 1)).toEqual({ kind: 'rate_limited' });
    respond(500, fx.STEAM_BAD_GATEWAY_HTML);
    expect(await getSchemaForGame('k3y', 1)).toEqual({
      kind: 'error',
      status: 500,
    });
  });
});

describe('getGlobalAchievementPercentages', () => {
  it('U6: string and number percents become numbers; unparseable ones are dropped', async () => {
    respond(200, fx.GLOBAL_PERCENTAGES_OK);
    const result = await getGlobalAchievementPercentages(fx.BG3_APP_ID);
    expect(result.kind).toBe('ok');
    const pct = result.kind === 'ok' ? [...result.percentages] : [];
    expect(pct).toEqual([
      ['ACH_FIRST_STEPS', 87.3],
      ['ACH_SECRET', 3.2],
      ['ACH_NUMERIC', 12.5],
    ]);
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(
      '/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/',
    );
    expect(url.searchParams.get('gameid')).toBe(String(fx.BG3_APP_ID));
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('a 502 HTML page is an error', async () => {
    respond(502, fx.STEAM_BAD_GATEWAY_HTML);
    expect(await getGlobalAchievementPercentages(1)).toEqual({
      kind: 'error',
      status: 502,
    });
  });
});
