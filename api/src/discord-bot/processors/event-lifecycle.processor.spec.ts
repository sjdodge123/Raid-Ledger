import { Test, TestingModule } from '@nestjs/testing';
import { EventLifecycleProcessor } from './event-lifecycle.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EmbedPosterService } from '../services/embed-poster.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { GameAffinityNotificationService } from '../../notifications/game-affinity-notification.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { Job } from 'bullmq';
import type { EventLifecycleJobData } from '../queues/event-lifecycle.queue';
import type { EventPayload } from '../listeners/event.listener';

const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const futureEnd = new Date(futureDate.getTime() + 3 * 60 * 60 * 1000);

/** Build a chainable Drizzle select that resolves via `.limit()`. */
function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makePayload(overrides?: Partial<EventPayload>): EventPayload {
  return {
    eventId: 42,
    event: {
      id: 42,
      title: 'Raid Night',
      startTime: futureDate.toISOString(),
      endTime: futureEnd.toISOString(),
      signupCount: 0,
      maxAttendees: 20,
      game: { name: 'WoW', coverUrl: 'https://example.com/wow.jpg' },
    },
    gameId: 101,
    creatorId: 1,
    ...overrides,
  };
}

function makeJob(payload: EventPayload): Job<EventLifecycleJobData> {
  return {
    data: { eventId: payload.eventId, payload },
  } as Job<EventLifecycleJobData>;
}

function buildProviders(mockDb: Record<string, jest.Mock>) {
  return [
    EventLifecycleProcessor,
    { provide: DrizzleAsyncProvider, useValue: mockDb },
    {
      provide: DiscordBotClientService,
      useValue: {
        isConnected: jest.fn().mockReturnValue(true),
      },
    },
    {
      provide: EmbedPosterService,
      useValue: {
        postEmbed: jest.fn().mockResolvedValue(true),
      },
    },
    {
      provide: ScheduledEventService,
      useValue: {
        createScheduledEvent: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: GameAffinityNotificationService,
      useValue: {
        notifyGameAffinity: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: SettingsService,
      useValue: {
        getBranding: jest.fn().mockResolvedValue({
          communityName: 'Test Guild',
        }),
        getClientUrl: jest.fn().mockResolvedValue('https://app.test'),
        getDefaultTimezone: jest.fn().mockResolvedValue(null),
      },
    },
  ];
}

// =========================================================================
// Happy path: all three operations execute
// =========================================================================

describe('EventLifecycleProcessor — happy path', () => {
  let processor: EventLifecycleProcessor;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let embedPoster: jest.Mocked<EmbedPosterService>;
  let gameAffinityService: jest.Mocked<GameAffinityNotificationService>;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain([])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EventLifecycleProcessor);
    scheduledEventService = module.get(ScheduledEventService);
    embedPoster = module.get(EmbedPosterService);
    gameAffinityService = module.get(GameAffinityNotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a Discord scheduled event', async () => {
    const payload = makePayload();
    await processor.process(makeJob(payload));

    expect(scheduledEventService.createScheduledEvent).toHaveBeenCalledWith(
      42,
      payload.event,
      101,
      undefined,
      undefined,
    );
  });

  it('posts the embed via EmbedPosterService', async () => {
    const payload = makePayload();
    await processor.process(makeJob(payload));

    expect(embedPoster.postEmbed).toHaveBeenCalledWith(
      42,
      payload.event,
      101,
      undefined,
      undefined,
    );
  });

  it('sends game affinity notifications with discord message info', async () => {
    const discordMsg = {
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
    };
    mockDb.select.mockReturnValue(makeSelectChain([discordMsg]));

    const payload = makePayload();
    await processor.process(makeJob(payload));

    expect(gameAffinityService.notifyGameAffinity).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 42,
        eventTitle: 'Raid Night',
        gameName: 'WoW',
        gameId: 101,
        creatorId: 1,
        clientUrl: 'https://app.test',
        discordMessage: discordMsg,
      }),
    );
  });

  it('passes null discordMessage when embed posting fails', async () => {
    embedPoster.postEmbed.mockResolvedValue(false);

    const payload = makePayload();
    await processor.process(makeJob(payload));

    expect(gameAffinityService.notifyGameAffinity).toHaveBeenCalledWith(
      expect.objectContaining({
        discordMessage: null,
      }),
    );
  });
});

// =========================================================================
// Skip conditions
// =========================================================================

describe('EventLifecycleProcessor — skip conditions', () => {
  let processor: EventLifecycleProcessor;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let embedPoster: jest.Mocked<EmbedPosterService>;
  let gameAffinityService: jest.Mocked<GameAffinityNotificationService>;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain([])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EventLifecycleProcessor);
    clientService = module.get(DiscordBotClientService);
    embedPoster = module.get(EmbedPosterService);
    gameAffinityService = module.get(GameAffinityNotificationService);
    scheduledEventService = module.get(ScheduledEventService);
  });

  afterEach(() => jest.clearAllMocks());

  it('skips all work when bot is not connected', async () => {
    clientService.isConnected.mockReturnValue(false);
    const payload = makePayload();

    await processor.process(makeJob(payload));

    expect(scheduledEventService.createScheduledEvent).not.toHaveBeenCalled();
    expect(embedPoster.postEmbed).not.toHaveBeenCalled();
    expect(gameAffinityService.notifyGameAffinity).not.toHaveBeenCalled();
  });

  it('skips game affinity when gameId is missing', async () => {
    const payload = makePayload({ gameId: null });
    await processor.process(makeJob(payload));

    expect(embedPoster.postEmbed).toHaveBeenCalled();
    expect(gameAffinityService.notifyGameAffinity).not.toHaveBeenCalled();
  });

  it('skips game affinity when creatorId is missing', async () => {
    const payload = makePayload({ creatorId: undefined });
    await processor.process(makeJob(payload));

    expect(gameAffinityService.notifyGameAffinity).not.toHaveBeenCalled();
  });

  it('skips game affinity when game name is missing', async () => {
    const payload = makePayload();
    payload.event.game = undefined as unknown as {
      name: string;
      coverUrl: string | null;
    };
    await processor.process(makeJob(payload));

    expect(gameAffinityService.notifyGameAffinity).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Lead-time gating
// =========================================================================

describe('EventLifecycleProcessor — lead-time gating', () => {
  let processor: EventLifecycleProcessor;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let embedPoster: jest.Mocked<EmbedPosterService>;
  let gameAffinityService: jest.Mocked<GameAffinityNotificationService>;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain([])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EventLifecycleProcessor);
    scheduledEventService = module.get(ScheduledEventService);
    embedPoster = module.get(EmbedPosterService);
    gameAffinityService = module.get(GameAffinityNotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('still creates scheduled event for events outside lead time', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const payload = makePayload({
      event: {
        ...makePayload().event,
        startTime: farFuture.toISOString(),
        endTime: new Date(
          farFuture.getTime() + 3 * 60 * 60 * 1000,
        ).toISOString(),
      },
    });

    await processor.process(makeJob(payload));

    expect(scheduledEventService.createScheduledEvent).toHaveBeenCalled();
  });

  it('skips embed posting for events outside lead time', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const payload = makePayload({
      event: {
        ...makePayload().event,
        startTime: farFuture.toISOString(),
        endTime: new Date(
          farFuture.getTime() + 3 * 60 * 60 * 1000,
        ).toISOString(),
      },
    });

    await processor.process(makeJob(payload));

    expect(embedPoster.postEmbed).not.toHaveBeenCalled();
  });

  it('skips game affinity for events outside lead time', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const payload = makePayload({
      event: {
        ...makePayload().event,
        startTime: farFuture.toISOString(),
        endTime: new Date(
          farFuture.getTime() + 3 * 60 * 60 * 1000,
        ).toISOString(),
      },
    });

    await processor.process(makeJob(payload));

    expect(gameAffinityService.notifyGameAffinity).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Error handling — graceful failures
// =========================================================================

describe('EventLifecycleProcessor — error handling', () => {
  let processor: EventLifecycleProcessor;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let embedPoster: jest.Mocked<EmbedPosterService>;
  let gameAffinityService: jest.Mocked<GameAffinityNotificationService>;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain([])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EventLifecycleProcessor);
    scheduledEventService = module.get(ScheduledEventService);
    embedPoster = module.get(EmbedPosterService);
    gameAffinityService = module.get(GameAffinityNotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('continues embed posting when scheduled event creation fails', async () => {
    scheduledEventService.createScheduledEvent.mockRejectedValue(
      new Error('Discord API error'),
    );
    const payload = makePayload();

    await processor.process(makeJob(payload));

    expect(embedPoster.postEmbed).toHaveBeenCalled();
  });

  it('continues affinity notifications when embed posting returns false', async () => {
    embedPoster.postEmbed.mockResolvedValue(false);
    const payload = makePayload();

    await processor.process(makeJob(payload));

    expect(gameAffinityService.notifyGameAffinity).toHaveBeenCalled();
  });

  it('does not throw when game affinity notifications fail', async () => {
    gameAffinityService.notifyGameAffinity.mockRejectedValue(
      new Error('Notification dispatch failed'),
    );
    const payload = makePayload();

    await expect(processor.process(makeJob(payload))).resolves.not.toThrow();
  });
});
