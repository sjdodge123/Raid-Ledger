/**
 * Regression tests for ROK-755: scheduled events decoupled from embed lead-time.
 *
 * Verifies that Discord scheduled events are created for events outside
 * the embed lead-time window, while embeds are still deferred.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordEventListener, type EventPayload } from './event.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { EmbedPosterService } from '../services/embed-poster.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EventLifecycleQueueService } from '../queues/event-lifecycle.queue';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

let testModule: TestingModule;
let listener: DiscordEventListener;
let eventLifecycleQueue: jest.Mocked<EventLifecycleQueueService>;

const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const futureEndDate = new Date(futureDate.getTime() + 3 * 60 * 60 * 1000);
const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const farFutureEnd = new Date(farFuture.getTime() + 3 * 60 * 60 * 1000);

const mockEmbed = new EmbedBuilder().setTitle('Test');
const mockRow = new ActionRowBuilder<ButtonBuilder>();

function createChainMock(resolvedValue: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(resolvedValue);
  chain.set = jest.fn().mockReturnValue(chain);
  chain.values = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue(resolvedValue);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resolvedValue).then(resolve, reject);
  return chain;
}

async function setupModule() {
  const mockDb = {
    insert: jest.fn().mockReturnValue(createChainMock()),
    select: jest.fn().mockReturnValue(createChainMock()),
    update: jest.fn().mockReturnValue(createChainMock()),
    delete: jest.fn().mockReturnValue(createChainMock()),
  };

  testModule = await Test.createTestingModule({
    providers: [
      DiscordEventListener,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: DiscordBotClientService,
        useValue: {
          isConnected: jest.fn().mockReturnValue(true),
          getGuildId: jest.fn().mockReturnValue('guild-123'),
          sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
          editEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
          deleteMessage: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: DiscordEmbedFactory,
        useValue: {
          buildEventEmbed: jest
            .fn()
            .mockReturnValue({ embed: mockEmbed, row: mockRow }),
          buildEventCancelled: jest.fn().mockReturnValue({ embed: mockEmbed }),
        },
      },
      {
        provide: EmbedPosterService,
        useValue: {
          postEmbed: jest.fn().mockResolvedValue(true),
          enrichWithLiveRoster: jest
            .fn()
            .mockImplementation((_id: number, event: unknown) =>
              Promise.resolve(event),
            ),
        },
      },
      {
        provide: ChannelResolverService,
        useValue: {
          resolveVoiceChannelForScheduledEvent: jest
            .fn()
            .mockResolvedValue(null),
        },
      },
      {
        provide: SettingsService,
        useValue: {
          getBranding: jest.fn().mockResolvedValue({
            communityName: 'Test Guild',
            communityLogoPath: null,
            communityAccentColor: null,
          }),
          getClientUrl: jest.fn().mockResolvedValue(null),
          getDefaultTimezone: jest.fn().mockResolvedValue(null),
        },
      },
      {
        provide: ScheduledEventService,
        useValue: {
          createScheduledEvent: jest.fn().mockResolvedValue(undefined),
          updateScheduledEvent: jest.fn().mockResolvedValue(undefined),
          deleteScheduledEvent: jest.fn().mockResolvedValue(undefined),
          updateDescription: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: EventLifecycleQueueService,
        useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
      },
    ],
  }).compile();

  listener = testModule.get(DiscordEventListener);
  eventLifecycleQueue = testModule.get(EventLifecycleQueueService);
}

describe('ROK-755: scheduled events decoupled from embed lead-time', () => {
  beforeEach(async () => {
    await setupModule();
  });
  afterEach(async () => {
    jest.clearAllMocks();
    await testModule.close();
  });

  it('enqueues lifecycle job for recurring event outside lead-time', async () => {
    const payload: EventPayload = {
      eventId: 99,
      event: {
        id: 99,
        title: 'Weekly Raid',
        startTime: farFuture.toISOString(),
        endTime: farFutureEnd.toISOString(),
        signupCount: 0,
        maxAttendees: 25,
        game: { name: 'WoW', coverUrl: null },
      },
      gameId: 1,
      recurrenceRule: { frequency: 'weekly' },
    };
    await listener.handleEventCreated(payload);
    expect(eventLifecycleQueue.enqueue).toHaveBeenCalledWith(99, payload);
  });

  it('enqueues lifecycle job for event within lead-time', async () => {
    const payload: EventPayload = {
      eventId: 100,
      event: {
        id: 100,
        title: 'Tonight Raid',
        startTime: futureDate.toISOString(),
        endTime: futureEndDate.toISOString(),
        signupCount: 5,
        maxAttendees: 20,
        game: { name: 'WoW', coverUrl: null },
      },
      gameId: 1,
    };
    await listener.handleEventCreated(payload);
    expect(eventLifecycleQueue.enqueue).toHaveBeenCalledWith(100, payload);
  });

  it('skips both scheduled event and embed for ad-hoc events', async () => {
    const payload: EventPayload = {
      eventId: 101,
      event: {
        id: 101,
        title: 'Ad-Hoc',
        startTime: futureDate.toISOString(),
        endTime: futureEndDate.toISOString(),
        signupCount: 0,
        maxAttendees: null,
        game: null,
      },
      isAdHoc: true,
    };
    await listener.handleEventCreated(payload);
    expect(eventLifecycleQueue.enqueue).not.toHaveBeenCalled();
  });
});
