import { GuildScheduledEventStatus } from 'discord.js';
import { Test } from '@nestjs/testing';
import {
  setupScheduledEventTestModule,
  makeDiscordApiError,
  type ScheduledEventMocks,
} from './scheduled-event.service.spec-helpers';
import { ScheduledEventService } from './scheduled-event.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/** Build a select chain that resolves at .where() (no .limit()). */
const createSelectChainNoLimit = (rows: unknown[] = []) => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(rows);
  return chain;
};

describe('completeExpiredEvents — normal completion', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('completes a Discord Scheduled Event that has ended', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Active,
    });
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
      status: GuildScheduledEventStatus.Completed,
    });
  });

  it('completes multiple expired events', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
      { id: 43, discordScheduledEventId: 'se-2' },
    ]);
    const seIdChain1 = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain2 = mocks.createSelectChain([
      { discordScheduledEventId: 'se-2' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain1)
      .mockReturnValueOnce(seIdChain2);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch
      .mockResolvedValueOnce({
        id: 'se-1',
        status: GuildScheduledEventStatus.Active,
      })
      .mockResolvedValueOnce({
        id: 'se-2',
        status: GuildScheduledEventStatus.Active,
      });
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).toHaveBeenCalledTimes(2);
  });

  it('skips when no candidates found', async () => {
    mocks.mockDb.select.mockReturnValue(createSelectChainNoLimit([]));
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.fetch).not.toHaveBeenCalled();
  });
});

describe('completeExpiredEvents — idempotent & skip conditions', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('is idempotent — already Completed events are skipped', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mocks.mockDb.update.mockReturnValue(mocks.createUpdateChain());
    mocks.mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Completed,
    });
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockGuild.scheduledEvents.edit).not.toHaveBeenCalled();
  });

  it('skips when bot is not connected', async () => {
    mocks.clientService.isConnected.mockReturnValue(false);
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockDb.select).not.toHaveBeenCalled();
  });

  it('skips when no guild is available', async () => {
    mocks.clientService.getGuild.mockReturnValue(null);
    await mocks.service.completeExpiredEvents();
    expect(mocks.mockDb.select).not.toHaveBeenCalled();
  });
});

describe('completeExpiredEvents — error handling', () => {
  let mocks: ScheduledEventMocks;

  beforeEach(async () => {
    mocks = await setupScheduledEventTestModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('clears DB reference when Discord event was manually deleted (10070)', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'deleted-se-id' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'deleted-se-id' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    const updateChain = mocks.createUpdateChain();
    mocks.mockDb.update.mockReturnValue(updateChain);
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      makeDiscordApiError(10070, 'Unknown Scheduled Event'),
    );
    await expect(mocks.service.completeExpiredEvents()).resolves.not.toThrow();
  });

  it('does not throw on Discord API errors', async () => {
    const candidateChain = createSelectChainNoLimit([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = mocks.createSelectChain([
      { discordScheduledEventId: 'se-1' },
    ]);
    mocks.mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mocks.mockGuild.scheduledEvents.fetch.mockRejectedValue(
      new Error('Rate limited'),
    );
    await expect(mocks.service.completeExpiredEvents()).resolves.not.toThrow();
  });
});

// ─── ROK-944: Cache bypass and embed-sync tests ───────────────

/** Helper to build the select chain for findCompletionCandidates (no .limit()). */
const buildCandidateChain = (rows: unknown[] = []) => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(rows);
  return chain;
};

/** Helper to build the select chain for getScheduledEventId (uses .limit()). */
const buildSeIdChain = (seId: string) => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest
    .fn()
    .mockResolvedValue([{ discordScheduledEventId: seId }]);
  return chain;
};

/** Helper to build a chainable Drizzle update mock. */
const buildUpdateChain = () => {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
};

/**
 * Build a test module and manually wire the ActiveEventCacheService mock.
 *
 * NestJS @Optional() with union types (e.g. `ActiveEventCacheService | null`)
 * causes TypeScript to emit `Object` as the design type, preventing automatic
 * token resolution. We work around this by setting the private field directly
 * after module creation — matching how production DI wires it.
 */
async function setupModuleWithCache(mockEventCache: {
  getRecentlyEndedEvents: jest.Mock;
}) {
  const mockGuild = {
    scheduledEvents: {
      create: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
      edit: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      fetch: jest.fn().mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Active,
      }),
    },
  };
  const mockDb = {
    select: jest.fn(),
    update: jest.fn().mockReturnValue(buildUpdateChain()),
  };
  const module = await Test.createTestingModule({
    providers: [
      ScheduledEventService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: DiscordBotClientService,
        useValue: {
          isConnected: jest.fn().mockReturnValue(true),
          getGuild: jest.fn().mockReturnValue(mockGuild),
        },
      },
      {
        provide: ChannelResolverService,
        useValue: {
          resolveVoiceChannelForScheduledEvent: jest
            .fn()
            .mockResolvedValue('voice-channel-123'),
        },
      },
      {
        provide: SettingsService,
        useValue: {
          getClientUrl: jest.fn().mockResolvedValue('https://raidledger.app'),
        },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation((_n: string, fn: () => Promise<void>) => fn()),
        },
      },
    ],
  }).compile();

  const service = module.get(ScheduledEventService);
  // Manually inject cache mock (see comment above re: @Optional + union type)
  (service as any).eventCache = mockEventCache;

  return { service, mockDb, mockGuild };
}

describe('completeExpiredEvents — ROK-944: cache bypass', () => {
  afterEach(() => jest.clearAllMocks());

  it('completes events via DB query when cache returns empty', async () => {
    const mockCache = {
      getRecentlyEndedEvents: jest.fn().mockReturnValue([]),
    };
    const { service, mockDb, mockGuild } =
      await setupModuleWithCache(mockCache);

    const candidateChain = buildCandidateChain([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = buildSeIdChain('se-1');
    mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mockDb.update.mockReturnValue(buildUpdateChain());
    mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Active,
    });

    await service.completeExpiredEvents();

    // Verify the cache WAS consulted (confirms injection worked)
    expect(mockCache.getRecentlyEndedEvents).toHaveBeenCalled();
    // The DB query should have been called even though cache was empty
    expect(candidateChain.where).toHaveBeenCalled();
    // The event should have been completed in Discord
    expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
      status: GuildScheduledEventStatus.Completed,
    });
  });

  it('does not short-circuit on empty cache — DB fallback always runs', async () => {
    const mockCache = {
      getRecentlyEndedEvents: jest.fn().mockReturnValue([]),
    };
    const { service, mockDb, mockGuild } =
      await setupModuleWithCache(mockCache);

    const candidateChain = buildCandidateChain([
      { id: 100, discordScheduledEventId: 'se-old' },
    ]);
    const seIdChain = buildSeIdChain('se-old');
    mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mockDb.update.mockReturnValue(buildUpdateChain());
    mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-old',
      status: GuildScheduledEventStatus.Active,
    });

    const result = await service.completeExpiredEvents();

    // Verify the cache WAS consulted (confirms injection worked)
    expect(mockCache.getRecentlyEndedEvents).toHaveBeenCalled();
    // Should NOT return false (early exit) — should proceed to completion
    expect(result).not.toBe(false);
  });
});

/**
 * Build a test module and manually wire the EmbedSyncQueueService mock.
 *
 * After the ROK-944 fix, ScheduledEventService will accept an @Optional()
 * EmbedSyncQueueService and call enqueue() after each completion.
 * We manually set the private field since the constructor does not accept
 * it yet (this is TDD — the service code has not been changed).
 */
async function setupModuleWithEmbedSync(mockEmbedSyncQueue: {
  enqueue: jest.Mock;
}) {
  const mockGuild = {
    scheduledEvents: {
      create: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
      edit: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      fetch: jest.fn().mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Active,
      }),
    },
  };
  const mockDb = {
    select: jest.fn(),
    update: jest.fn().mockReturnValue(buildUpdateChain()),
  };
  const module = await Test.createTestingModule({
    providers: [
      ScheduledEventService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: DiscordBotClientService,
        useValue: {
          isConnected: jest.fn().mockReturnValue(true),
          getGuild: jest.fn().mockReturnValue(mockGuild),
        },
      },
      {
        provide: ChannelResolverService,
        useValue: {
          resolveVoiceChannelForScheduledEvent: jest
            .fn()
            .mockResolvedValue('voice-channel-123'),
        },
      },
      {
        provide: SettingsService,
        useValue: {
          getClientUrl: jest.fn().mockResolvedValue('https://raidledger.app'),
        },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation((_n: string, fn: () => Promise<void>) => fn()),
        },
      },
    ],
  }).compile();

  const service = module.get(ScheduledEventService);
  // Manually inject embed-sync mock (service does not accept it yet — TDD)
  (service as any).embedSyncQueue = mockEmbedSyncQueue;

  return { service, mockDb, mockGuild };
}

describe('completeExpiredEvents — ROK-944: embed-sync enqueue', () => {
  afterEach(() => jest.clearAllMocks());

  it('enqueues embed-sync after completing an event', async () => {
    const mockEmbedSync = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const { service, mockDb, mockGuild } =
      await setupModuleWithEmbedSync(mockEmbedSync);

    const candidateChain = buildCandidateChain([
      { id: 42, discordScheduledEventId: 'se-1' },
    ]);
    const seIdChain = buildSeIdChain('se-1');
    mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain);
    mockDb.update.mockReturnValue(buildUpdateChain());
    mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1',
      status: GuildScheduledEventStatus.Active,
    });

    await service.completeExpiredEvents();

    expect(mockEmbedSync.enqueue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('complete'),
    );
  });

  it('enqueues embed-sync for each completed event', async () => {
    const mockEmbedSync = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const { service, mockDb, mockGuild } =
      await setupModuleWithEmbedSync(mockEmbedSync);

    const candidateChain = buildCandidateChain([
      { id: 42, discordScheduledEventId: 'se-1' },
      { id: 43, discordScheduledEventId: 'se-2' },
    ]);
    const seIdChain1 = buildSeIdChain('se-1');
    const seIdChain2 = buildSeIdChain('se-2');
    mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain1)
      .mockReturnValueOnce(seIdChain2);
    mockDb.update.mockReturnValue(buildUpdateChain());
    mockGuild.scheduledEvents.fetch
      .mockResolvedValueOnce({
        id: 'se-1',
        status: GuildScheduledEventStatus.Active,
      })
      .mockResolvedValueOnce({
        id: 'se-2',
        status: GuildScheduledEventStatus.Active,
      });

    await service.completeExpiredEvents();

    expect(mockEmbedSync.enqueue).toHaveBeenCalledTimes(2);
    expect(mockEmbedSync.enqueue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('complete'),
    );
    expect(mockEmbedSync.enqueue).toHaveBeenCalledWith(
      43,
      expect.stringContaining('complete'),
    );
  });

  it('continues completing remaining events when embed-sync enqueue throws', async () => {
    const mockEmbedSync = {
      enqueue: jest
        .fn()
        .mockRejectedValueOnce(new Error('Redis down'))
        .mockResolvedValueOnce(undefined),
    };
    const { service, mockDb, mockGuild } =
      await setupModuleWithEmbedSync(mockEmbedSync);

    const candidateChain = buildCandidateChain([
      { id: 42, discordScheduledEventId: 'se-1' },
      { id: 43, discordScheduledEventId: 'se-2' },
    ]);
    const seIdChain1 = buildSeIdChain('se-1');
    const seIdChain2 = buildSeIdChain('se-2');
    mockDb.select
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(seIdChain1)
      .mockReturnValueOnce(seIdChain2);
    mockDb.update.mockReturnValue(buildUpdateChain());
    mockGuild.scheduledEvents.fetch
      .mockResolvedValueOnce({
        id: 'se-1',
        status: GuildScheduledEventStatus.Active,
      })
      .mockResolvedValueOnce({
        id: 'se-2',
        status: GuildScheduledEventStatus.Active,
      });

    await service.completeExpiredEvents();

    // Both events should still be completed in Discord despite enqueue failure on first
    expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledTimes(2);
    expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-1', {
      status: GuildScheduledEventStatus.Completed,
    });
    expect(mockGuild.scheduledEvents.edit).toHaveBeenCalledWith('se-2', {
      status: GuildScheduledEventStatus.Completed,
    });
    // Embed-sync enqueue should have been attempted for both despite first failure
    expect(mockEmbedSync.enqueue).toHaveBeenCalledTimes(2);
  });
});
