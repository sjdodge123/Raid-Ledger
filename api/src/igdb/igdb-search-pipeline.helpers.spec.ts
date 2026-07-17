/**
 * Tests for search pipeline wiring (ROK-773, ROK-953, ROK-1381).
 * Verifies ITAD-primary with IGDB fallback logic, error handling,
 * partial prefix query optimization, and the short-TTL ITAD cache.
 */
import {
  runSearchPipeline,
  isPartialPrefixQuery,
  buildItadCacheKey,
  type SearchPipelineParams,
} from './igdb-search-pipeline.helpers';
import { IGDB_CONFIG } from './igdb.constants';

// Mock the ITAD deps builder
jest.mock('./igdb-itad-deps.helpers', () => ({
  buildItadSearchDeps: jest.fn().mockReturnValue({}),
}));

// Mock the ITAD search executor
jest.mock('./igdb-itad-search.helpers', () => ({
  executeItadSearch: jest.fn(),
}));

// Mock the IGDB search executor
jest.mock('./igdb-search-executor.helpers', () => ({
  executeSearch: jest.fn(),
  doSearchRefresh: jest.fn(),
}));

// Mock the IGDB API helpers
jest.mock('./igdb-api.helpers', () => ({
  fetchFromIgdb: jest.fn(),
  fetchWithRetry: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeItadSearch } = require('./igdb-itad-search.helpers') as {
  executeItadSearch: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeSearch } = require('./igdb-search-executor.helpers') as {
  executeSearch: jest.Mock;
};

/** Minimal redis mock covering the two calls the ITAD cache layer makes. */
function makeRedis(
  overrides: Partial<{ get: jest.Mock; setex: jest.Mock }> = {},
): SearchPipelineParams['redis'] {
  return {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    ...overrides,
  } as unknown as SearchPipelineParams['redis'];
}

function makeParams(
  overrides: Partial<SearchPipelineParams> = {},
): SearchPipelineParams {
  return {
    db: {} as SearchPipelineParams['db'],
    redis: makeRedis(),
    itadService: {} as SearchPipelineParams['itadService'],
    resolveCredentials: jest
      .fn()
      .mockResolvedValue({ clientId: 'id', clientSecret: 'secret' }),
    getAccessToken: jest.fn().mockResolvedValue('token'),
    clearToken: jest.fn(),
    getAdultFilter: jest.fn().mockResolvedValue(false),
    upsertGames: jest.fn().mockResolvedValue([]),
    normalizeQuery: jest.fn((q: string) => q.toLowerCase()),
    getCacheKey: jest.fn((q: string) => `search:${q}`),
    queryIgdb: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('runSearchPipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ITAD results when ITAD search succeeds with results', async () => {
    const itadResult = {
      games: [{ id: 0, name: 'Game Alpha', slug: 'game-alpha' }],
      cached: false,
      source: 'itad' as const,
    };
    executeItadSearch.mockResolvedValue(itadResult);

    const params = makeParams();
    const triggerRefresh = jest.fn();

    const result = await runSearchPipeline(
      params,
      'game alpha',
      'game alpha',
      triggerRefresh,
    );

    expect(result).toEqual(itadResult);
    expect(executeSearch).not.toHaveBeenCalled();
  });

  it('falls back to IGDB when ITAD returns empty results', async () => {
    const itadResult = {
      games: [],
      cached: false,
      source: 'itad' as const,
    };
    const igdbResult = {
      games: [{ id: 1, name: 'IGDB Game' }],
      cached: false,
      source: 'igdb' as const,
    };
    executeItadSearch.mockResolvedValue(itadResult);
    executeSearch.mockResolvedValue(igdbResult);

    const params = makeParams();
    const triggerRefresh = jest.fn();

    const result = await runSearchPipeline(
      params,
      'game',
      'game',
      triggerRefresh,
    );

    expect(result).toEqual(igdbResult);
    expect(executeSearch).toHaveBeenCalled();
  });

  it('falls back to IGDB when ITAD search throws an error', async () => {
    executeItadSearch.mockRejectedValue(new Error('ITAD API down'));
    const igdbResult = {
      games: [{ id: 2, name: 'Fallback Game' }],
      cached: false,
      source: 'igdb' as const,
    };
    executeSearch.mockResolvedValue(igdbResult);

    const params = makeParams();
    const triggerRefresh = jest.fn();

    const result = await runSearchPipeline(
      params,
      'test',
      'test',
      triggerRefresh,
    );

    expect(result).toEqual(igdbResult);
  });

  it('falls back to IGDB when ITAD throws non-Error', async () => {
    executeItadSearch.mockRejectedValue('string error');
    const igdbResult = {
      games: [],
      cached: false,
      source: 'igdb' as const,
    };
    executeSearch.mockResolvedValue(igdbResult);

    const params = makeParams();
    const triggerRefresh = jest.fn();

    const result = await runSearchPipeline(
      params,
      'test',
      'test',
      triggerRefresh,
    );

    expect(result).toEqual(igdbResult);
  });

  it('passes triggerRefresh callback to IGDB executeSearch', async () => {
    executeItadSearch.mockResolvedValue({
      games: [],
      cached: false,
      source: 'itad' as const,
    });
    executeSearch.mockResolvedValue({
      games: [],
      cached: false,
      source: 'igdb' as const,
    });

    const params = makeParams();
    const triggerRefresh = jest.fn();

    await runSearchPipeline(params, 'test', 'test', triggerRefresh);

    expect(executeSearch).toHaveBeenCalledWith(
      expect.any(Object),
      'test',
      'test',
      triggerRefresh,
    );
  });

  it('skips ITAD for partial prefix queries (ROK-953)', async () => {
    const igdbResult = {
      games: [{ id: 3, name: 'World of Warcraft' }],
      cached: false,
      source: 'igdb' as const,
    };
    executeSearch.mockResolvedValue(igdbResult);

    const params = makeParams();
    const triggerRefresh = jest.fn();

    const result = await runSearchPipeline(
      params,
      'world of',
      'world of',
      triggerRefresh,
    );

    expect(result).toEqual(igdbResult);
    expect(executeItadSearch).not.toHaveBeenCalled();
    expect(executeSearch).toHaveBeenCalled();
  });

  it('uses ITAD for complete multi-word queries (ROK-953)', async () => {
    const itadResult = {
      games: [{ id: 4, name: 'World of Warcraft', slug: 'wow' }],
      cached: false,
      source: 'itad' as const,
    };
    executeItadSearch.mockResolvedValue(itadResult);

    const params = makeParams();
    const triggerRefresh = jest.fn();

    const result = await runSearchPipeline(
      params,
      'world of warcraft',
      'world of warcraft',
      triggerRefresh,
    );

    expect(result).toEqual(itadResult);
    expect(executeItadSearch).toHaveBeenCalled();
  });
});

describe('ITAD short-TTL cache (ROK-1381)', () => {
  const itadGames = [{ id: 7, name: 'Game Alpha', slug: 'game-alpha' }];
  const itadResult = { games: itadGames, cached: false, source: 'itad' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves a cached result with zero ITAD/IGDB executor calls', async () => {
    const redis = makeRedis({
      get: jest.fn().mockResolvedValue(JSON.stringify(itadGames)),
    });
    const params = makeParams({ redis });

    const result = await runSearchPipeline(
      params,
      'game alpha',
      'game alpha',
      jest.fn(),
    );

    expect(result).toEqual({
      games: itadGames,
      cached: true,
      source: 'redis',
    });
    expect(executeItadSearch).not.toHaveBeenCalled();
    expect(executeSearch).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('writes the ITAD result to the cache on a miss', async () => {
    executeItadSearch.mockResolvedValue(itadResult);
    const redis = makeRedis();
    const params = makeParams({ redis });

    await runSearchPipeline(params, 'game alpha', 'game alpha', jest.fn());

    expect(redis.get).toHaveBeenCalledWith(
      'igdb:search:itad:adult=0:game alpha',
    );
    expect(redis.setex).toHaveBeenCalledWith(
      'igdb:search:itad:adult=0:game alpha',
      IGDB_CONFIG.ITAD_SEARCH_CACHE_TTL,
      JSON.stringify(itadGames),
    );
  });

  it('keys the cache on adult-filter state (no cross-state leakage)', async () => {
    executeItadSearch.mockResolvedValue(itadResult);
    const redis = makeRedis();
    const params = makeParams({
      redis,
      getAdultFilter: jest.fn().mockResolvedValue(true),
    });

    await runSearchPipeline(params, 'game alpha', 'game alpha', jest.fn());

    expect(redis.get).toHaveBeenCalledWith(
      'igdb:search:itad:adult=1:game alpha',
    );
    expect(redis.setex).toHaveBeenCalledWith(
      'igdb:search:itad:adult=1:game alpha',
      IGDB_CONFIG.ITAD_SEARCH_CACHE_TTL,
      JSON.stringify(itadGames),
    );
  });

  it('does not cache empty ITAD results (IGDB fallback unchanged)', async () => {
    executeItadSearch.mockResolvedValue({
      games: [],
      cached: false,
      source: 'itad' as const,
    });
    const igdbResult = { games: [], cached: false, source: 'igdb' as const };
    executeSearch.mockResolvedValue(igdbResult);
    const redis = makeRedis();
    const params = makeParams({ redis });

    const result = await runSearchPipeline(params, 'game', 'game', jest.fn());

    expect(result).toEqual(igdbResult);
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('treats an empty cached array as a miss', async () => {
    executeItadSearch.mockResolvedValue(itadResult);
    const redis = makeRedis({ get: jest.fn().mockResolvedValue('[]') });
    const params = makeParams({ redis });

    const result = await runSearchPipeline(
      params,
      'game alpha',
      'game alpha',
      jest.fn(),
    );

    expect(result).toEqual(itadResult);
    expect(executeItadSearch).toHaveBeenCalled();
  });

  it('treats a redis read error as a miss (search unaffected)', async () => {
    executeItadSearch.mockResolvedValue(itadResult);
    const redis = makeRedis({
      get: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    const params = makeParams({ redis });

    const result = await runSearchPipeline(
      params,
      'game alpha',
      'game alpha',
      jest.fn(),
    );

    expect(result).toEqual(itadResult);
    expect(executeItadSearch).toHaveBeenCalled();
  });

  it('does not break the search when the cache write fails', async () => {
    executeItadSearch.mockResolvedValue(itadResult);
    const redis = makeRedis({
      setex: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    const params = makeParams({ redis });

    const result = await runSearchPipeline(
      params,
      'game alpha',
      'game alpha',
      jest.fn(),
    );

    expect(result).toEqual(itadResult);
  });

  it('snapshots the adult filter ONCE per request — a mid-request toggle cannot cache one state under the other key (TOCTOU)', async () => {
    executeItadSearch.mockResolvedValue(itadResult);
    const redis = makeRedis();
    // First read (cache key) sees ON; any later re-read would see the
    // admin having toggled OFF mid-request.
    const getAdultFilter = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const params = makeParams({ redis, getAdultFilter });

    await runSearchPipeline(params, 'game alpha', 'game alpha', jest.fn());

    // Key and content must both come from the single snapshot read…
    expect(getAdultFilter).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledWith(
      'igdb:search:itad:adult=1:game alpha',
      IGDB_CONFIG.ITAD_SEARCH_CACHE_TTL,
      JSON.stringify(itadGames),
    );
    // …including the getAdultFilter threaded into the ITAD deps builder.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildItadSearchDeps } = require('./igdb-itad-deps.helpers') as {
      buildItadSearchDeps: jest.Mock;
    };
    const depsArg = buildItadSearchDeps.mock.calls[0][0] as {
      getAdultFilter: () => Promise<boolean>;
    };
    await expect(depsArg.getAdultFilter()).resolves.toBe(true);
  });

  it('never touches the ITAD cache for partial prefix queries', async () => {
    executeSearch.mockResolvedValue({
      games: [],
      cached: false,
      source: 'igdb' as const,
    });
    const redis = makeRedis();
    const params = makeParams({ redis });

    await runSearchPipeline(params, 'world of', 'world of', jest.fn());

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });
});

describe('buildItadCacheKey (ROK-1381)', () => {
  it('embeds adult-filter state so entries never collide across states', () => {
    expect(buildItadCacheKey('halo', false)).not.toBe(
      buildItadCacheKey('halo', true),
    );
  });

  it('is stable for identical inputs', () => {
    expect(buildItadCacheKey('halo infinite', true)).toBe(
      buildItadCacheKey('halo infinite', true),
    );
  });

  it('distinguishes different normalized queries', () => {
    expect(buildItadCacheKey('halo', false)).not.toBe(
      buildItadCacheKey('destiny', false),
    );
  });
});

describe('isPartialPrefixQuery (ROK-953)', () => {
  it('returns true for multi-word query with short last token', () => {
    expect(isPartialPrefixQuery('world of')).toBe(true);
    expect(isPartialPrefixQuery('world o')).toBe(true);
    expect(isPartialPrefixQuery('final fantasy x')).toBe(true);
  });

  it('returns false for single-word queries', () => {
    expect(isPartialPrefixQuery('wo')).toBe(false);
    expect(isPartialPrefixQuery('w')).toBe(false);
    expect(isPartialPrefixQuery('world')).toBe(false);
  });

  it('returns false when last token is 3+ characters', () => {
    expect(isPartialPrefixQuery('world of war')).toBe(false);
    expect(isPartialPrefixQuery('world of warcraft')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(isPartialPrefixQuery('')).toBe(false);
    expect(isPartialPrefixQuery('  ')).toBe(false);
    expect(isPartialPrefixQuery('a b')).toBe(true);
  });
});
