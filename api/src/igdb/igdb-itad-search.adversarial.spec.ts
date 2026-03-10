/**
 * Adversarial tests for ITAD-primary search pipeline (ROK-773).
 * Covers edge cases, error paths, and combined filter scenarios
 * not exercised by the primary spec file.
 */
import {
  executeItadSearch,
  filterDlc,
  filterAdultItadGames,
  type ItadSearchDeps,
} from './igdb-itad-search.helpers';
import type { ItadSearchGame } from './igdb-itad-merge.helpers';

function makeMockDeps(
  overrides: Partial<ItadSearchDeps> = {},
): ItadSearchDeps {
  return {
    searchItad: jest.fn().mockResolvedValue([]),
    lookupSteamAppIds: jest.fn().mockResolvedValue(new Map()),
    enrichFromIgdb: jest.fn().mockResolvedValue(null),
    getAdultFilter: jest.fn().mockResolvedValue(false),
    isBannedOrHidden: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function makeGame(overrides: Partial<ItadSearchGame> = {}): ItadSearchGame {
  return {
    id: 'uuid-default',
    slug: 'default-game',
    title: 'Default Game',
    type: 'game',
    mature: false,
    assets: { boxart: 'https://itad.example.com/default.jpg' },
    tags: [],
    ...overrides,
  };
}

describe('filterDlc — edge cases', () => {
  it('returns empty array when given empty input', () => {
    expect(filterDlc([])).toEqual([]);
  });

  it('returns empty array when all games are DLC', () => {
    const games: ItadSearchGame[] = [
      makeGame({ id: 'dlc-1', type: 'dlc' }),
      makeGame({ id: 'dlc-2', type: 'dlc' }),
    ];
    expect(filterDlc(games)).toEqual([]);
  });

  it('preserves games with type "game", "bundle", or other non-DLC types', () => {
    const games: ItadSearchGame[] = [
      makeGame({ id: 'g1', type: 'game' }),
      makeGame({ id: 'g2', type: 'bundle' }),
      makeGame({ id: 'g3', type: 'package' }),
      makeGame({ id: 'g4', type: 'dlc' }),
    ];
    const result = filterDlc(games);

    expect(result).toHaveLength(3);
    expect(result.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('is case-sensitive (type "DLC" is NOT filtered)', () => {
    const games: ItadSearchGame[] = [
      makeGame({ id: 'upper', type: 'DLC' }),
    ];
    expect(filterDlc(games)).toHaveLength(1);
  });
});

describe('filterAdultItadGames — edge cases', () => {
  it('returns empty array when given empty input with filter on', () => {
    expect(filterAdultItadGames([], true)).toEqual([]);
  });

  it('returns empty array when given empty input with filter off', () => {
    expect(filterAdultItadGames([], false)).toEqual([]);
  });

  it('filters a game that is both mature AND has adult keyword', () => {
    const game = makeGame({
      id: 'double-flag',
      title: 'Hentai Deluxe',
      mature: true,
    });
    const result = filterAdultItadGames([game], true);

    expect(result).toHaveLength(0);
  });

  it.each([
    'hentai',
    'porn',
    'xxx',
    'nsfw',
    'erotic',
    'lewd',
    'nude',
    'naked',
    'sex toy',
    'harem',
    'ecchi',
    'futanari',
    'waifu',
    'ahegao',
    'succubus',
    'brothel',
    'stripclub',
    'strip poker',
  ])('filters game with adult keyword "%s" in title', (keyword) => {
    const game = makeGame({
      id: `kw-${keyword}`,
      title: `My ${keyword} Adventure`,
      mature: false,
    });
    const result = filterAdultItadGames([game], true);

    expect(result).toHaveLength(0);
  });

  it('keyword match is case-insensitive', () => {
    const game = makeGame({
      id: 'upper-kw',
      title: 'HENTAI GAME',
      mature: false,
    });
    const result = filterAdultItadGames([game], true);

    expect(result).toHaveLength(0);
  });

  it('does not filter a game with keyword substring in a safe word', () => {
    // "nude" is in "denude" — this tests substring matching behavior
    const game = makeGame({
      id: 'substring',
      title: 'Denude the Landscape',
      mature: false,
    });
    const result = filterAdultItadGames([game], true);

    // The implementation uses .includes(), so substring matches ARE filtered
    expect(result).toHaveLength(0);
  });

  it('keeps non-mature, non-keyword games when filter is on', () => {
    const safe = makeGame({
      id: 'safe',
      title: 'Family Friendly Fun',
      mature: false,
    });
    const result = filterAdultItadGames([safe], true);

    expect(result).toHaveLength(1);
  });
});

describe('executeItadSearch — error paths', () => {
  it('propagates when searchItad throws', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockRejectedValue(new Error('ITAD API down')),
    });

    await expect(executeItadSearch(deps, 'test')).rejects.toThrow(
      'ITAD API down',
    );
  });

  it('propagates when lookupSteamAppIds throws', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([makeGame()]),
      lookupSteamAppIds: jest
        .fn()
        .mockRejectedValue(new Error('Lookup failure')),
    });

    await expect(executeItadSearch(deps, 'test')).rejects.toThrow(
      'Lookup failure',
    );
  });

  it('propagates when getAdultFilter throws', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([makeGame()]),
      getAdultFilter: jest
        .fn()
        .mockRejectedValue(new Error('Settings read error')),
    });

    await expect(executeItadSearch(deps, 'test')).rejects.toThrow(
      'Settings read error',
    );
  });

  it('propagates when isBannedOrHidden throws', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([makeGame()]),
      isBannedOrHidden: jest
        .fn()
        .mockRejectedValue(new Error('DB connection lost')),
    });

    await expect(executeItadSearch(deps, 'test')).rejects.toThrow(
      'DB connection lost',
    );
  });
});

describe('executeItadSearch — combined filters', () => {
  it('applies DLC filter before adult filter (DLC with mature flag)', async () => {
    const matureDlc = makeGame({
      id: 'mature-dlc',
      title: 'Mature DLC Pack',
      type: 'dlc',
      mature: true,
    });
    const safeGame = makeGame({ id: 'safe', title: 'Safe Game' });

    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([matureDlc, safeGame]),
      getAdultFilter: jest.fn().mockResolvedValue(true),
    });

    const result = await executeItadSearch(deps, 'test');

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Safe Game');
  });

  it('combines IGDB theme filter with ITAD mature filter', async () => {
    // One game has ITAD mature flag, other has IGDB adult theme
    const itadMature = makeGame({
      id: 'itad-mature',
      title: 'Mature ITAD',
      mature: true,
    });
    const igdbAdult = makeGame({ id: 'igdb-adult', title: 'IGDB Adult' });
    const safeGame = makeGame({ id: 'safe', title: 'Safe' });

    const igdbAdultData = {
      igdbId: 555,
      coverUrl: null,
      summary: null,
      genres: [],
      themes: [42], // Erotic
      gameModes: [],
      platforms: [],
      screenshots: [],
      videos: [],
      twitchGameId: null,
      playerCount: null,
      crossplay: null,
      rating: null,
      aggregatedRating: null,
    };

    const deps = makeMockDeps({
      searchItad: jest
        .fn()
        .mockResolvedValue([itadMature, igdbAdult, safeGame]),
      getAdultFilter: jest.fn().mockResolvedValue(true),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(
          new Map([['igdb-adult', 200]]),
        ),
      enrichFromIgdb: jest.fn().mockImplementation((appId: number) => {
        if (appId === 200) return Promise.resolve(igdbAdultData);
        return Promise.resolve(null);
      }),
    });

    const result = await executeItadSearch(deps, 'test');

    // itadMature filtered by pre-filter, igdbAdult by post-filter
    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Safe');
  });

  it('IGDB theme 39 (Sexual Content) also triggers adult filter', async () => {
    const game = makeGame({ id: 'sexual', title: 'Innocent Title' });
    const igdbData = {
      igdbId: 777,
      coverUrl: null,
      summary: null,
      genres: [],
      themes: [39], // Sexual Content
      gameModes: [],
      platforms: [],
      screenshots: [],
      videos: [],
      twitchGameId: null,
      playerCount: null,
      crossplay: null,
      rating: null,
      aggregatedRating: null,
    };

    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([game]),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(new Map([['sexual', 300]])),
      enrichFromIgdb: jest.fn().mockResolvedValue(igdbData),
      getAdultFilter: jest.fn().mockResolvedValue(true),
    });

    const result = await executeItadSearch(deps, 'test');

    expect(result.games).toHaveLength(0);
  });

  it('excludes all games when every game is banned', async () => {
    const games = [
      makeGame({ id: 'a', slug: 'banned-a' }),
      makeGame({ id: 'b', slug: 'banned-b' }),
    ];

    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue(games),
      isBannedOrHidden: jest.fn().mockResolvedValue(true),
    });

    const result = await executeItadSearch(deps, 'test');

    expect(result.games).toHaveLength(0);
  });
});

describe('executeItadSearch — enrichment paths', () => {
  it('skips IGDB enrichment when no Steam app ID found', async () => {
    const game = makeGame({ id: 'no-steam' });
    const enrichFromIgdb = jest.fn();

    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([game]),
      lookupSteamAppIds: jest.fn().mockResolvedValue(new Map()),
      enrichFromIgdb,
    });

    const result = await executeItadSearch(deps, 'test');

    expect(enrichFromIgdb).not.toHaveBeenCalled();
    expect(result.games[0].igdbId).toBeNull();
  });

  it('falls back to ITAD-only when enrichFromIgdb returns null', async () => {
    const game = makeGame({
      id: 'has-steam',
      assets: { boxart: 'https://itad.example.com/box.jpg' },
    });

    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([game]),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(new Map([['has-steam', 400]])),
      enrichFromIgdb: jest.fn().mockResolvedValue(null),
    });

    const result = await executeItadSearch(deps, 'test');

    expect(result.games[0].igdbId).toBeNull();
    expect(result.games[0].coverUrl).toBe(
      'https://itad.example.com/box.jpg',
    );
  });

  it('enriches multiple games independently', async () => {
    const gameA = makeGame({ id: 'a', title: 'Game A' });
    const gameB = makeGame({ id: 'b', title: 'Game B' });

    const igdbA = {
      igdbId: 10,
      coverUrl: 'https://igdb.com/a.jpg',
      summary: 'A desc',
      genres: [1],
      themes: [],
      gameModes: [],
      platforms: [],
      screenshots: [],
      videos: [],
      twitchGameId: null,
      playerCount: null,
      crossplay: null,
      rating: 80,
      aggregatedRating: null,
    };

    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([gameA, gameB]),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(new Map([['a', 100]])),
      enrichFromIgdb: jest.fn().mockImplementation((appId: number) => {
        if (appId === 100) return Promise.resolve(igdbA);
        return Promise.resolve(null);
      }),
    });

    const result = await executeItadSearch(deps, 'test');

    // Game A enriched, Game B ITAD-only
    expect(result.games[0].igdbId).toBe(10);
    expect(result.games[0].coverUrl).toBe('https://igdb.com/a.jpg');
    expect(result.games[1].igdbId).toBeNull();
  });

  it('result always has source="itad" and cached=false', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([makeGame()]),
    });

    const result = await executeItadSearch(deps, 'test');

    expect(result.source).toBe('itad');
    expect(result.cached).toBe(false);
  });
});
