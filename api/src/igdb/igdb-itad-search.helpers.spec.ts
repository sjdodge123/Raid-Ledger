/**
 * Tests for ITAD-primary search pipeline (ROK-773).
 */
import { Logger } from '@nestjs/common';
import {
  executeItadSearch,
  filterDlc,
  filterAdultItadGames,
  type ItadSearchDeps,
} from './igdb-itad-search.helpers';
import type { ItadSearchGame } from './igdb-itad-merge.helpers';

function makeMockDeps(overrides: Partial<ItadSearchDeps> = {}): ItadSearchDeps {
  return {
    searchItad: jest.fn().mockResolvedValue([]),
    lookupSteamAppIds: jest.fn().mockResolvedValue(new Map()),
    enrichFromIgdb: jest.fn().mockResolvedValue(null),
    getAdultFilter: jest.fn().mockResolvedValue(false),
    isBannedOrHidden: jest.fn().mockResolvedValue(false),
    upsertGame: jest
      .fn()
      .mockImplementation((g) => Promise.resolve({ ...g, id: 1 })),
    ...overrides,
  };
}

const GAME_A: ItadSearchGame = {
  id: 'uuid-a',
  slug: 'game-a',
  title: 'Game A',
  type: 'game',
  mature: false,
  assets: { boxart: 'https://itad.example.com/a.jpg' },
  tags: ['rpg'],
  steamAppId: 100,
};

const GAME_B: ItadSearchGame = {
  id: 'uuid-b',
  slug: 'game-b',
  title: 'Game B',
  type: 'game',
  mature: false,
  assets: { boxart: 'https://itad.example.com/b.jpg' },
  tags: ['action'],
  steamAppId: 200,
};

const DLC_GAME: ItadSearchGame = {
  id: 'uuid-dlc',
  slug: 'game-dlc',
  title: 'Game A - DLC Pack',
  type: 'dlc',
  mature: false,
};

const MATURE_GAME: ItadSearchGame = {
  id: 'uuid-mature',
  slug: 'mature-game',
  title: 'Mature Game',
  type: 'game',
  mature: true,
  tags: ['adult'],
};

describe('filterDlc', () => {
  it('excludes DLC type games', () => {
    const games = [GAME_A, DLC_GAME, GAME_B];
    const result = filterDlc(games);

    expect(result).toHaveLength(2);
    expect(result.map((g) => g.title)).toEqual(['Game A', 'Game B']);
  });

  it('keeps all non-DLC games', () => {
    const games = [GAME_A, GAME_B];
    expect(filterDlc(games)).toHaveLength(2);
  });
});

describe('filterAdultItadGames', () => {
  it('returns all games when adult filter is off', () => {
    const games = [GAME_A, MATURE_GAME];
    const result = filterAdultItadGames(games, false);

    expect(result).toHaveLength(2);
  });

  it('excludes ITAD mature games when filter is on', () => {
    const games = [GAME_A, MATURE_GAME];
    const result = filterAdultItadGames(games, true);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Game A');
  });

  it('excludes games matching adult keywords when filter is on', () => {
    const adultKeywordGame: ItadSearchGame = {
      ...GAME_A,
      id: 'uuid-hentai',
      title: 'Hentai Game Deluxe',
      mature: false,
    };
    const result = filterAdultItadGames([GAME_A, adultKeywordGame], true);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Game A');
  });
});

describe('executeItadSearch', () => {
  it('returns ITAD-only results when no IGDB enrichment', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([GAME_A]),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(new Map([['uuid-a', 100]])),
      enrichFromIgdb: jest.fn().mockResolvedValue(null),
    });

    const result = await executeItadSearch(deps, 'game a');

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Game A');
    expect(result.games[0].itadBoxartUrl).toBe(
      'https://itad.example.com/a.jpg',
    );
    expect(result.games[0].igdbId).toBeNull();
    expect(result.source).toBe('itad');
  });

  it('enriches with IGDB when external_games match found', async () => {
    const igdbData = {
      igdbId: 999,
      coverUrl: 'https://igdb.com/cover.jpg',
      summary: 'A great game',
      genres: [12],
      themes: [1],
      gameModes: [1],
      platforms: [6],
      screenshots: [],
      videos: [],
      twitchGameId: null,
      playerCount: null,
      crossplay: null,
      rating: 85,
      aggregatedRating: 90,
    };
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([GAME_A]),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(new Map([['uuid-a', 100]])),
      enrichFromIgdb: jest.fn().mockResolvedValue(igdbData),
    });

    const result = await executeItadSearch(deps, 'game a');

    expect(result.games[0].igdbId).toBe(999);
    expect(result.games[0].coverUrl).toBe('https://igdb.com/cover.jpg');
    expect(result.games[0].summary).toBe('A great game');
    expect(result.source).toBe('itad');
  });

  it('filters out DLC from results', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([GAME_A, DLC_GAME]),
    });

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Game A');
  });

  it('applies adult filter when enabled', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([GAME_A, MATURE_GAME]),
      getAdultFilter: jest.fn().mockResolvedValue(true),
    });

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Game A');
  });

  it('excludes banned/hidden games', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([GAME_A, GAME_B]),
      isBannedOrHidden: jest
        .fn()
        .mockImplementation((slug: string) =>
          Promise.resolve(slug === 'game-b'),
        ),
    });

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Game A');
  });

  it('includes all games when adult filter is off', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([GAME_A, MATURE_GAME]),
      getAdultFilter: jest.fn().mockResolvedValue(false),
    });

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(2);
  });

  it('returns empty results when ITAD returns nothing', async () => {
    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([]),
    });

    const result = await executeItadSearch(deps, 'nonexistent');

    expect(result.games).toHaveLength(0);
    expect(result.source).toBe('itad');
  });

  it('logs rejected enrichments at debug level and excludes them', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    const deps = makeMockDeps({
      searchItad: jest.fn().mockResolvedValue([GAME_A, GAME_B]),
      lookupSteamAppIds: jest.fn().mockResolvedValue(
        new Map([
          ['uuid-a', 100],
          ['uuid-b', 200],
        ]),
      ),
      enrichFromIgdb: jest.fn().mockImplementation((steamAppId: number) => {
        if (steamAppId === 200) {
          return Promise.reject(new Error('IGDB timeout'));
        }
        return Promise.resolve(null);
      }),
    });

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Game A');

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('game-b'));
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('IGDB timeout'),
    );

    debugSpy.mockRestore();
  });

  it('also filters adult via IGDB themes when enriched', async () => {
    const igdbAdult = {
      igdbId: 888,
      coverUrl: null,
      summary: null,
      genres: [],
      themes: [42],
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
      searchItad: jest.fn().mockResolvedValue([GAME_A]),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(new Map([['uuid-a', 100]])),
      enrichFromIgdb: jest.fn().mockResolvedValue(igdbAdult),
      getAdultFilter: jest.fn().mockResolvedValue(true),
    });

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(0);
  });
});
