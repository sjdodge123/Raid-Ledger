/**
 * ROK-1622 AC2: `process()` treated "no tracked message row" as success.
 *
 * The sync is enqueued with a 2s coalescing delay, so when the initial post
 * takes longer than that the sync runs first, finds nothing, and returns —
 * the state correction is dropped and the embed keeps whatever colour the
 * post wrote. "Not yet" must retry; "never" must stay silent.
 *
 * MUTATION: put `if (active.length === 0) return;` back at the top of
 * `EmbedSyncProcessor.process` and the first test fails with
 * `received function did not throw`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmbedSyncProcessor } from './embed-sync.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EMBED_SYNC_QUEUE } from '../queues/embed-sync.queue';
import { QueueHealthService } from '../../queue/queue-health.service';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { Job } from 'bullmq';
import type { EmbedSyncJobData } from '../queues/embed-sync.queue';

const FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const FUTURE_END = new Date(FUTURE.getTime() + 3 * 60 * 60 * 1000);

function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.innerJoin = jest.fn().mockReturnValue(chain);
  chain.groupBy = jest.fn().mockResolvedValue([]);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

/** An events row as `fetchEvent` selects it, created `ageMs` ago. */
const eventRow = (overrides: Record<string, unknown> = {}, ageMs = 500) => ({
  id: 1,
  duration: [FUTURE, FUTURE_END],
  title: 'Raid Night',
  description: null,
  gameId: null,
  maxAttendees: null,
  slotConfig: null,
  cancelledAt: null,
  isAdHoc: false,
  reschedulingPollId: null,
  extendedUntil: null,
  recurrenceGroupId: null,
  ephemeralVoiceChannelId: null,
  notificationChannelOverride: null,
  createdAt: new Date(Date.now() - ageMs),
  ...overrides,
});

const job = (attemptsMade = 0) =>
  ({
    data: { eventId: 1, reason: 'signup' },
    attemptsMade,
    opts: { attempts: 3 },
  }) as unknown as Job<EmbedSyncJobData>;

describe('EmbedSyncProcessor — missing tracked message (ROK-1622)', () => {
  let processor: EmbedSyncProcessor;
  let mockDb: Record<string, jest.Mock>;
  let scheduledEvent: { updateDescription: jest.Mock };

  /** `process()` selects tracked messages first, then the event row. */
  const seed = (records: unknown[], event: unknown) => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain(records))
      .mockReturnValueOnce(makeSelectChain(event ? [event] : []));
  };

  beforeEach(async () => {
    mockDb = { select: jest.fn(), update: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbedSyncProcessor,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: getQueueToken(EMBED_SYNC_QUEUE),
          useValue: { getJobCounts: jest.fn() },
        },
        { provide: QueueHealthService, useValue: { register: jest.fn() } },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            editEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
          },
        },
        {
          provide: DiscordEmbedFactory,
          useValue: {
            buildEventUpdate: jest.fn().mockReturnValue({
              embed: new EmbedBuilder().setTitle('T'),
              row: new ActionRowBuilder<ButtonBuilder>(),
            }),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getBranding: jest
              .fn()
              .mockResolvedValue({ communityName: 'Test Guild' }),
            getClientUrl: jest.fn().mockResolvedValue(null),
            getDefaultTimezone: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ScheduledEventService,
          useValue: {
            updateDescription: jest.fn().mockResolvedValue(undefined),
            completeScheduledEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveVoiceChannelHonoringOverride: jest
              .fn()
              .mockResolvedValue(null),
          },
        },
      ],
    }).compile();
    processor = module.get(EmbedSyncProcessor);
    scheduledEvent = module.get(ScheduledEventService);
  });

  afterEach(() => jest.clearAllMocks());

  it('throws so BullMQ retries when the post has not landed its row yet', async () => {
    seed([], eventRow({}, 500));

    await expect(processor.process(job())).rejects.toThrow(
      /no tracked embed message yet/i,
    );
  });

  it('gives up quietly on the final attempt rather than failing the job', async () => {
    seed([], eventRow({}, 500));

    await expect(processor.process(job(2))).resolves.toBeUndefined();
  });

  it('stays silent when the event is too old for a post to still be in flight', async () => {
    seed([], eventRow({}, 10 * 60_000));

    await expect(processor.process(job())).resolves.toBeUndefined();
    expect(scheduledEvent.updateDescription).not.toHaveBeenCalled();
  });

  it('stays silent for a cancelled event that never got an embed', async () => {
    seed([], eventRow({ cancelledAt: new Date() }, 500));

    await expect(processor.process(job())).resolves.toBeUndefined();
  });

  it('stays silent for a Quick Play event, which is never tracked here', async () => {
    seed([], eventRow({ isAdHoc: true }, 500));

    await expect(processor.process(job())).resolves.toBeUndefined();
  });

  it('stays silent for a deleted event', async () => {
    seed([], null);

    await expect(processor.process(job())).resolves.toBeUndefined();
  });

  it('stays silent when a row exists but the embed is CANCELLED — deliberately dead', async () => {
    seed(
      [
        {
          id: 'rec-1',
          channelId: 'c1',
          messageId: 'm1',
          embedState: EMBED_STATES.CANCELLED,
        },
      ],
      eventRow({}, 500),
    );

    await expect(processor.process(job())).resolves.toBeUndefined();
    expect(scheduledEvent.updateDescription).not.toHaveBeenCalled();
  });
});
