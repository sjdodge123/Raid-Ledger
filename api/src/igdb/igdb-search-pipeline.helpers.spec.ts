/**
 * Tests for search pipeline wiring (ROK-773, ROK-953).
 * Verifies ITAD-primary with IGDB fallback logic, error handling,
 * and partial prefix query optimization.
 */
import {
  runSearchPipeline,
  isPartialPrefixQuery,
  type SearchPipelineParams,
} from './igdb-search-pipeline.helpers';

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

function makeParams(
  overrides: Partial<SearchPipelineParams> = {},
): SearchPipelineParams {
  return {
    db: {} as SearchPipelineParams['db'],
    redis: {} as SearchPipelineParams['redis'],
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

    expect(result).toBe(itadResult);
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

    expect(result).toBe(igdbResult);
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

    expect(result).toBe(igdbResult);
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

    expect(result).toBe(igdbResult);
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

    expect(result).toBe(igdbResult);
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

    expect(result).toBe(itadResult);
    expect(executeItadSearch).toHaveBeenCalled();
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
