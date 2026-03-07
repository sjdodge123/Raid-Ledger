/**
 * Tests for EmbedSyncProcessor.computeEmbedState() with extendedUntil (ROK-576).
 *
 * The key behavior: when an event has been auto-extended, the embed should
 * remain LIVE (not COMPLETED) until the extendedUntil time passes.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EmbedSyncProcessor } from './embed-sync.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../../src/settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { Job } from 'bullmq';
import type { EmbedSyncJobData } from '../queues/embed-sync.queue';

/** Build a chainable Drizzle select mock that resolves via `.limit()` or `.then`. */
function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.select = jest.fn().mockReturnValue(chain);
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

function makeUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

const mockEmbed = new EmbedBuilder().setTitle('Test');
const mockRow = new ActionRowBuilder<ButtonBuilder>();

/** A Discord message record for event 42. */
const mockRecord = {
  id: 'record-uuid',
  eventId: 42,
  guildId: 'guild-123',
  channelId: 'channel-789',
  messageId: 'msg-456',
  embedState: EMBED_STATES.LIVE,
};

/**
 * Build a minimal event row. Times are set by the caller to control state.
 */
function makeEvent(overrides: {
  startTime: Date;
  endTime: Date;
  extendedUntil?: Date | null;
  cancelledAt?: Date | null;
  signupCount?: number;
  maxAttendees?: number | null;
}) {
  return {
    id: 42,
    title: 'Raid Night',
    description: null,
    duration: [overrides.startTime, overrides.endTime] as [Date, Date],
    extendedUntil: overrides.extendedUntil ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    maxAttendees: overrides.maxAttendees ?? null,
    gameId: null,
    slotConfig: null,
    isAdHoc: false,
    discordScheduledEventId: null,
  };
}

let processor: EmbedSyncProcessor;
let mockDb: Record<string, jest.Mock>;
let scheduledEventService: jest.Mocked<ScheduledEventService>;

/**
 * Wire up the DB to return record -> event -> empty signups -> empty roster -> no game.
 */
function setupDb(event: ReturnType<typeof makeEvent>) {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockRecord]))
    .mockReturnValueOnce(makeSelectChain([event]))
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([]));
  const updateChain = makeUpdateChain();
  mockDb.update.mockReturnValue(updateChain);
}

beforeEach(async () => {
  mockDb = {
    select: jest.fn(),
    update: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EmbedSyncProcessor,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
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
          buildEventUpdate: jest
            .fn()
            .mockReturnValue({ embed: mockEmbed, row: mockRow }),
        },
      },
      {
        provide: SettingsService,
        useValue: {
          getBranding: jest.fn().mockResolvedValue({
            communityName: null,
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
          updateDescription: jest.fn().mockResolvedValue(undefined),
          completeScheduledEvent: jest.fn().mockResolvedValue(undefined),
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
    ],
  }).compile();

  processor = module.get(EmbedSyncProcessor);
  scheduledEventService = module.get(ScheduledEventService);
});

afterEach(() => {
  jest.clearAllMocks();
});

/** Helper to extract the embed state from buildEventUpdate mock calls. */
function getComputedState(): string {
  const embedFactory = processor[
    'embedFactory'
  ] as jest.Mocked<DiscordEmbedFactory>;
  return embedFactory.buildEventUpdate.mock.calls[0][2] as string;
}

// ─── Core LIVE-during-extension behavior ───────────────────────────────────

describe('EmbedSyncProcessor extendedUntil — LIVE during extension', () => {
  it('returns LIVE (not COMPLETED) when now < extendedUntil, even if now > original endTime', async () => {
    const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 5 * 60 * 1000);
    const extendedUntil = new Date(Date.now() + 10 * 60 * 1000);

    setupDb(makeEvent({ startTime, endTime, extendedUntil }));

    const job = {
      data: { eventId: 42, reason: 'extend' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(getComputedState()).toBe(EMBED_STATES.LIVE);
  });

  it('returns LIVE when event is in progress and extendedUntil is null', async () => {
    const startTime = new Date(Date.now() - 30 * 60 * 1000);
    const endTime = new Date(Date.now() + 90 * 60 * 1000);

    setupDb(makeEvent({ startTime, endTime, extendedUntil: null }));

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(getComputedState()).toBe(EMBED_STATES.LIVE);
  });
});

describe('EmbedSyncProcessor extendedUntil — COMPLETED after extension', () => {
  it('returns COMPLETED when now >= extendedUntil (extension window has passed)', async () => {
    const startTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 30 * 60 * 1000);
    const extendedUntil = new Date(Date.now() - 5 * 60 * 1000);

    setupDb(makeEvent({ startTime, endTime, extendedUntil }));

    const job = {
      data: { eventId: 42, reason: 'extend' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(getComputedState()).toBe(EMBED_STATES.COMPLETED);
  });

  it('returns COMPLETED when now >= original endTime and extendedUntil is null', async () => {
    const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 5 * 60 * 1000);

    setupDb(makeEvent({ startTime, endTime, extendedUntil: null }));

    const job = {
      data: { eventId: 42, reason: 'cron' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(getComputedState()).toBe(EMBED_STATES.COMPLETED);
  });
});

// ─── completeScheduledEvent only fires on COMPLETED transition ─────────────

describe('EmbedSyncProcessor extendedUntil — completeScheduledEvent', () => {
  it('calls completeScheduledEvent when embed transitions to COMPLETED', async () => {
    const startTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 30 * 60 * 1000);
    const extendedUntil = new Date(Date.now() - 1 * 60 * 1000);

    setupDb(makeEvent({ startTime, endTime, extendedUntil }));

    const job = {
      data: { eventId: 42, reason: 'extend' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);
    await Promise.resolve();

    expect(scheduledEventService.completeScheduledEvent).toHaveBeenCalledWith(
      42,
    );
  });

  it('does NOT call completeScheduledEvent while event is still extended (LIVE state)', async () => {
    const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 5 * 60 * 1000);
    const extendedUntil = new Date(Date.now() + 10 * 60 * 1000);

    setupDb(makeEvent({ startTime, endTime, extendedUntil }));

    const job = {
      data: { eventId: 42, reason: 'extend' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);
    await Promise.resolve();

    expect(scheduledEventService.completeScheduledEvent).not.toHaveBeenCalled();
  });
});
