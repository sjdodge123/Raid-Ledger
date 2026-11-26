/**
 * ROK-2353 review r1 (MINOR-2): while the `ai` plugin is inactive the read
 * path returns the empty response — no cached suggestions, no pre-gen
 * enqueue. With the plugin active the SWR read is unchanged.
 */
import { Logger } from '@nestjs/common';
import { AiSuggestionsService } from './ai-suggestions.service';
import { findLatestByHash, findLatestForLineup } from './cache.helpers';
import { resolveVoterScope } from './voter-scope.helpers';
import type { SettingsService } from '../../settings/settings.service';
import type { LlmService } from '../../ai/llm.service';
import type { AiSuggestionsPreGenQueueService } from './pre-gen.queue';
import type { AiQuotaCooldownService } from './quota-cooldown.service';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';

jest.mock('./cache.helpers', () => ({
  ...jest.requireActual<typeof import('./cache.helpers')>('./cache.helpers'),
  findLatestByHash: jest.fn(),
  findLatestForLineup: jest.fn(),
}));
jest.mock('./voter-scope.helpers', () => ({
  ...jest.requireActual<typeof import('./voter-scope.helpers')>(
    './voter-scope.helpers',
  ),
  resolveVoterScope: jest.fn(),
}));

type CacheRow = NonNullable<Awaited<ReturnType<typeof findLatestByHash>>>;

const mockFindLatestByHash = jest.mocked(findLatestByHash);
const mockFindLatestForLineup = jest.mocked(findLatestForLineup);
const mockResolveVoterScope = jest.mocked(resolveVoterScope);

function cacheRow(generatedAt: Date): CacheRow {
  return {
    id: 1,
    lineupId: 7,
    voterSetHash: 'hash-1',
    model: 'm',
    provider: 'google',
    generatedAt,
    payload: {
      suggestions: [
        {
          gameId: 42,
          name: 'Cached Game',
          slug: 'cached-game',
          coverUrl: null,
          confidence: 0.9,
          reasoning: 'cached',
          ownershipCount: 1,
          voterTotal: 1,
          communityOwnerCount: 1,
          wishlistCount: 0,
          nonOwnerPrice: null,
          itadCurrentCut: null,
          itadCurrentShop: null,
          itadCurrentUrl: null,
          earlyAccess: false,
          itadTags: [],
          playerCount: null,
        },
      ],
      generatedAt: generatedAt.toISOString(),
      voterCount: 1,
      voterScopeStrategy: 'community',
    },
  };
}

describe('AiSuggestionsService — AI plugin gate (ROK-2353)', () => {
  let service: AiSuggestionsService;
  let pluginActive: boolean;
  let enqueue: jest.Mock;

  beforeEach(() => {
    mockFindLatestByHash.mockReset();
    mockFindLatestForLineup.mockReset();
    mockResolveVoterScope.mockReset();
    pluginActive = false;
    enqueue = jest.fn().mockResolvedValue(undefined);
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([
      { id: 7, visibility: 'public', status: 'building' },
    ]);
    const llm = {
      isPluginActive: jest.fn(() => pluginActive),
      getActiveProviderKey: jest.fn().mockResolvedValue('google'),
    };
    service = new AiSuggestionsService(
      db as unknown as ConstructorParameters<typeof AiSuggestionsService>[0],
      {
        get: jest.fn().mockResolvedValue('true'),
      } as unknown as SettingsService,
      llm as unknown as LlmService,
      { enqueue } as unknown as AiSuggestionsPreGenQueueService,
      {
        isActive: jest.fn().mockResolvedValue(false),
      } as unknown as AiQuotaCooldownService,
    );
    mockResolveVoterScope.mockResolvedValue({
      userIds: [1],
      hash: 'hash-1',
      strategy: 'community',
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('plugin off: a fresh cached row is NOT served', async () => {
    mockFindLatestByHash.mockResolvedValue(cacheRow(new Date()));
    const res = await service.getSuggestions(7);
    expect(res.suggestions).toEqual([]);
    expect(res.cached).toBe(false);
    expect(mockFindLatestByHash).not.toHaveBeenCalled();
  });

  it('plugin off: a stale row is NOT served and no pre-gen job is queued', async () => {
    mockFindLatestByHash.mockResolvedValue(null);
    mockFindLatestForLineup.mockResolvedValue(cacheRow(new Date(0)));
    const res = await service.getSuggestions(7);
    expect(res.suggestions).toEqual([]);
    expect(res.stale).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('plugin off: a cold read neither queues a job nor reports pending', async () => {
    mockFindLatestByHash.mockResolvedValue(null);
    mockFindLatestForLineup.mockResolvedValue(null);
    const res = await service.getSuggestions(7);
    expect(res.pending).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('plugin on: a fresh cached row is served unchanged', async () => {
    pluginActive = true;
    mockFindLatestByHash.mockResolvedValue(cacheRow(new Date()));
    const res = await service.getSuggestions(7);
    expect(res.cached).toBe(true);
    expect(res.suggestions.map((s) => s.name)).toEqual(['Cached Game']);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('plugin on: a stale row is served and a pre-gen refresh is queued', async () => {
    pluginActive = true;
    mockFindLatestByHash.mockResolvedValue(null);
    mockFindLatestForLineup.mockResolvedValue(cacheRow(new Date(0)));
    const res = await service.getSuggestions(7);
    expect(res.stale).toBe(true);
    expect(res.suggestions.map((s) => s.name)).toEqual(['Cached Game']);
    expect(enqueue).toHaveBeenCalledWith(7, expect.any(Number), 'read');
  });
});
