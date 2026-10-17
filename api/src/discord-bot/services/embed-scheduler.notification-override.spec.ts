/**
 * ROK-599: Tests that EmbedSchedulerService fetches and passes through
 * notificationChannelOverride (and recurrenceGroupId) to EmbedPosterService.postEmbed.
 *
 * Verifies the scheduler does not drop the per-event override field when
 * building deferred embeds for future events.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EmbedSchedulerService } from './embed-scheduler.service';
import { EmbedPosterService } from './embed-poster.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('EmbedSchedulerService — notification override pass-through (ROK-599)', () => {
  let service: EmbedSchedulerService;
  let embedPoster: jest.Mocked<EmbedPosterService>;
  let mockDb: Record<string, jest.Mock>;

  // A future event date within 6-day lead time
  const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

  /** Build a chainable Drizzle select mock */
  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> & { then?: unknown } = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };

  function buildProviders() {
    return [
      EmbedSchedulerService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SettingsService,
        useValue: {
          getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
        },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation(
              async (_name: string, fn: () => Promise<void>) => fn(),
            ),
        },
      },
      {
        provide: EmbedPosterService,
        useValue: {
          postEmbed: jest.fn().mockResolvedValue(true),
        },
      },
    ];
  }
  async function setupBlock() {
    mockDb = {
      select: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();

    service = module.get(EmbedSchedulerService);
    embedPoster = module.get(EmbedPosterService);
  }

  beforeEach(async () => {
    await setupBlock();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // notificationChannelOverride is passed through to postEmbed
  // ============================================================
  describe('notificationChannelOverride pass-through', () => {
    it('passes notificationChannelOverride to postEmbed when the event has one', async () => {
      const eventWithOverride = {
        id: 42,
        title: 'Raid Night',
        description: 'Big raid',
        duration: [futureStart, futureEnd],
        gameId: 5,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: 'override-channel-999',
        maxAttendees: null,
        slotConfig: null,
      };

      // First select: events without embeds (the scheduler's main query)
      // Second select: game lookup (since gameId is 5)
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([eventWithOverride]))
        .mockReturnValueOnce(
          makeSelectChain([{ name: 'World of Warcraft', coverUrl: null }]),
        );

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        42,
        expect.any(Object),
        5,
        null,
        'override-channel-999',
      );
    });

    it('passes null notificationChannelOverride when event has none', async () => {
      const eventWithoutOverride = {
        id: 43,
        title: 'Casual Night',
        description: null,
        duration: [futureStart, futureEnd],
        gameId: null,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: null,
        maxAttendees: null,
        slotConfig: null,
      };

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([eventWithoutOverride]));
      // No game lookup needed (gameId is null)

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        43,
        expect.any(Object),
        null,
        null,
        null,
      );
    });

    it('passes recurrenceGroupId alongside notificationChannelOverride', async () => {
      const recurringEventWithOverride = {
        id: 44,
        title: 'Weekly Raid',
        description: null,
        duration: [futureStart, futureEnd],
        gameId: 5,
        recurrenceRule: { frequency: 'weekly' },
        recurrenceGroupId: 'rec-uuid-abc',
        notificationChannelOverride: 'override-channel-777',
        maxAttendees: null,
        slotConfig: null,
      };

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([recurringEventWithOverride]))
        .mockReturnValueOnce(
          makeSelectChain([{ name: 'World of Warcraft', coverUrl: null }]),
        );

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        44,
        expect.any(Object),
        5,
        'rec-uuid-abc',
        'override-channel-777',
      );
    });

    it('passes null recurrenceGroupId for standalone events', async () => {
      const standaloneEvent = {
        id: 45,
        title: 'One-off Event',
        description: null,
        duration: [futureStart, futureEnd],
        gameId: null,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: null,
        maxAttendees: null,
        slotConfig: null,
      };

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([standaloneEvent]));

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        45,
        expect.any(Object),
        null,
        null,
        null,
      );
    });
  });

  // ============================================================
  // Multiple events — each carries its own override independently
  // ============================================================
  describe('multiple events with different override states', () => {
    async function testCorrectlypassesdistinctoverridevaluesformultipleevents() {
      const eventA = {
        id: 100,
        title: 'Event A',
        description: null,
        duration: [futureStart, futureEnd],
        gameId: null,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: 'override-for-a',
        maxAttendees: null,
        slotConfig: null,
      };
      const eventB = {
        id: 101,
        title: 'Event B',
        description: null,
        duration: [futureStart, futureEnd],
        gameId: null,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: null,
        maxAttendees: null,
        slotConfig: null,
      };

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([eventA, eventB]));
      // No game lookups (both have gameId: null)

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledTimes(2);

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        100,
        expect.any(Object),
        null,
        null,
        'override-for-a',
      );

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        101,
        expect.any(Object),
        null,
        null,
        null,
      );
    }

    it('correctly passes distinct override values for multiple events', async () => {
      await testCorrectlypassesdistinctoverridevaluesformultipleevents();
    });
  });

  // ============================================================
  // Scheduler does nothing when there are no events to post
  // ============================================================
  describe('no events to post', () => {
    it('does not call postEmbed when there are no deferred events', async () => {
      mockDb.select = jest.fn().mockReturnValueOnce(makeSelectChain([]));

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Event data shape passed to postEmbed
  // ============================================================
  describe('event data shape', () => {
    it('passes event title and description in the event data object', async () => {
      const event = {
        id: 55,
        title: 'Important Raid',
        description: 'Bring pots',
        duration: [futureStart, futureEnd],
        gameId: null,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: null,
        maxAttendees: 25,
        slotConfig: { type: 'flex', flex: 25 },
      };

      mockDb.select = jest.fn().mockReturnValueOnce(makeSelectChain([event]));

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        55,
        expect.objectContaining({
          title: 'Important Raid',
          description: 'Bring pots',
          maxAttendees: 25,
        }),
        null,
        null,
        null,
      );
    });

    async function testIncludesgamedataintheeventobjectwhen() {
      const eventWithGame = {
        id: 56,
        title: 'WoW Raid',
        description: null,
        duration: [futureStart, futureEnd],
        gameId: 7,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: null,
        maxAttendees: null,
        slotConfig: null,
      };

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([eventWithGame]))
        .mockReturnValueOnce(
          makeSelectChain([
            {
              name: 'World of Warcraft',
              coverUrl: 'https://example.com/art.jpg',
            },
          ]),
        );

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        56,
        expect.objectContaining({
          game: {
            name: 'World of Warcraft',
            coverUrl: 'https://example.com/art.jpg',
          },
        }),
        7,
        null,
        null,
      );
    }

    it('includes game data in the event object when event has a gameId', async () => {
      await testIncludesgamedataintheeventobjectwhen();
    });

    it('passes null game when event has gameId but game not found in DB', async () => {
      const eventWithOrphanedGame = {
        id: 57,
        title: 'Mystery Raid',
        description: null,
        duration: [futureStart, futureEnd],
        gameId: 999,
        recurrenceRule: null,
        recurrenceGroupId: null,
        notificationChannelOverride: null,
        maxAttendees: null,
        slotConfig: null,
      };

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([eventWithOrphanedGame]))
        .mockReturnValueOnce(makeSelectChain([])); // game not found

      await service.handleScheduledEmbeds();

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        57,
        expect.objectContaining({ game: null }),
        999,
        null,
        null,
      );
    });
  });
});
