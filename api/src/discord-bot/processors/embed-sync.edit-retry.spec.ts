/**
 * ROK-2227 AC2: a failed embed edit must reach BullMQ when it is transient.
 *
 * The queue is configured `attempts: 3` + exponential backoff, but that only
 * fires when `process()` rejects. The processor used to catch, log and swallow
 * every `editEmbed` failure, so a 5xx or rate limit completed the job and left
 * the embed stale. A message/channel that is gone or unreachable (10008 /
 * 10003 / 50001) can never succeed, so it is still logged and dropped.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DiscordAPIError, EmbedBuilder } from 'discord.js';
import type { Job } from 'bullmq';
import { EmbedSyncProcessor } from './embed-sync.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EMBED_SYNC_QUEUE } from '../queues/embed-sync.queue';
import type { EmbedSyncJobData } from '../queues/embed-sync.queue';
import { QueueHealthService } from '../../queue/queue-health.service';
import {
  buildEventData,
  computeEmbedState,
  findTrackedMessages,
} from './embed-sync.helpers';
import { resolveGameHubLinkSafe } from '../channel-lifecycle/hub-link.resolver';

jest.mock('./embed-sync.helpers', () => ({
  findTrackedMessages: jest.fn(),
  buildEventData: jest.fn(),
  computeEmbedState: jest.fn(),
}));
jest.mock('../channel-lifecycle/hub-link.resolver', () => ({
  resolveGameHubLinkSafe: jest.fn(),
}));

const EVENT = {
  id: 316,
  cancelledAt: null,
  isAdHoc: false,
  reschedulingPollId: null,
  gameId: 1,
  guildId: null,
};

/** A tracked message row with no bump, so only the edit + persist run. */
function trackedRow(n: number) {
  return {
    id: `record-${n}`,
    eventId: 316,
    guildId: 'guild-123',
    channelId: `channel-${n}`,
    messageId: `msg-${n}`,
    embedState: EMBED_STATES.FILLING,
    bumpMessageId: null,
    bumpChannelId: null,
  };
}

/** Build a DiscordAPIError that satisfies `instanceof DiscordAPIError`. */
function discordError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', { value: code, configurable: true });
  Object.defineProperty(err, 'message', {
    value: `Discord error ${code}`,
    configurable: true,
  });
  return err;
}

const JOB = {
  data: { eventId: 316, reason: 'roster_updated' },
} as Job<EmbedSyncJobData>;

let processor: EmbedSyncProcessor;
let editEmbed: jest.Mock;
let update: jest.Mock;

/** db.select().from().where().limit() resolves to the event row. */
function selectChain(): Record<string, jest.Mock> {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue([EVENT]);
  return chain;
}

/** db.update().set().where() resolves. */
function updateChain(): Record<string, jest.Mock> {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

/** Providers with every collaborator stubbed to the happy path. */
function providers(db: Record<string, jest.Mock>) {
  return [
    EmbedSyncProcessor,
    { provide: DrizzleAsyncProvider, useValue: db },
    { provide: getQueueToken(EMBED_SYNC_QUEUE), useValue: {} },
    { provide: QueueHealthService, useValue: { register: jest.fn() } },
    {
      provide: DiscordBotClientService,
      useValue: {
        isConnected: jest.fn().mockReturnValue(true),
        getGuildId: jest.fn().mockReturnValue('guild-123'),
        editEmbed,
      },
    },
    {
      provide: DiscordEmbedFactory,
      useValue: {
        buildEventUpdate: jest
          .fn()
          .mockReturnValue({ embed: new EmbedBuilder().setTitle('Raid') }),
      },
    },
    {
      provide: SettingsService,
      useValue: {
        getBranding: jest.fn().mockResolvedValue({ communityName: 'Guild' }),
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
    { provide: ChannelResolverService, useValue: {} },
  ];
}

beforeEach(async () => {
  editEmbed = jest.fn().mockResolvedValue({ id: 'msg-1' });
  update = jest.fn().mockReturnValue(updateChain());
  const db = { select: jest.fn().mockReturnValue(selectChain()), update };
  (findTrackedMessages as jest.Mock).mockResolvedValue([trackedRow(1)]);
  (buildEventData as jest.Mock).mockResolvedValue({ id: 316 });
  (computeEmbedState as jest.Mock).mockReturnValue(EMBED_STATES.FILLING);
  (resolveGameHubLinkSafe as jest.Mock).mockResolvedValue(null);
  const module: TestingModule = await Test.createTestingModule({
    providers: providers(db),
  }).compile();
  processor = module.get(EmbedSyncProcessor);
});

afterEach(() => jest.clearAllMocks());

describe('EmbedSyncProcessor — transient edit failure (ROK-2227 AC2)', () => {
  it('rejects so BullMQ retries a 5xx / network failure', async () => {
    const transient = new Error('503 Service Unavailable');
    editEmbed.mockRejectedValue(transient);

    await expect(processor.process(JOB)).rejects.toBe(transient);
    // A failed edit must not record the new state as if it had landed.
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects on a non-permanent DiscordAPIError (rate limit)', async () => {
    editEmbed.mockRejectedValue(discordError(429));

    await expect(processor.process(JOB)).rejects.toBeInstanceOf(
      DiscordAPIError,
    );
  });

  it('still edits the other tracked messages before rejecting', async () => {
    (findTrackedMessages as jest.Mock).mockResolvedValue([
      trackedRow(1),
      trackedRow(2),
    ]);
    editEmbed
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ id: 'msg-2' });

    await expect(processor.process(JOB)).rejects.toThrow('socket hang up');
    expect(editEmbed).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('EmbedSyncProcessor — permanent edit failure (ROK-2227 AC2)', () => {
  it.each([
    [10008, 'Unknown Message'],
    [10003, 'Unknown Channel'],
    [50001, 'Missing Access'],
  ])('does not retry on %d %s', async (code) => {
    editEmbed.mockRejectedValue(discordError(code));

    await expect(processor.process(JOB)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('EmbedSyncProcessor — successful edit', () => {
  it('resolves and persists the new state', async () => {
    await expect(processor.process(JOB)).resolves.toBeUndefined();
    expect(editEmbed).toHaveBeenCalledWith(
      'channel-1',
      'msg-1',
      expect.any(EmbedBuilder),
      [],
      undefined,
    );
    expect(update).toHaveBeenCalledTimes(1);
  });
});
