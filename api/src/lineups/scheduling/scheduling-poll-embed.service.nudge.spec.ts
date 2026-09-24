/**
 * ROK-1683 — an open poll page hears about a vote right away, not after the
 * Discord card job runs.
 *
 * CONFIRMED FAILING on the branch base: `lineup:schedule-changed` was emitted
 * ONLY inside `syncEmbed`, which runs as the coalesced BullMQ card job (2s
 * window reset per change, concurrency 1, rate-limited `editEmbed`). Under
 * load a vote reached open pages 10s+ late. `fireUpdateEmbed` now emits first
 * and enqueues the card edit as before; the queue here never resolves, so any
 * emit these cases see came from the direct path.
 */
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { SchedulingPollEmbedQueueService } from './scheduling-poll-embed.queue';
import { LineupsGateway } from '../lineups.gateway';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { DiscordEmbedFactory } from '../../discord-bot/services/discord-embed.factory';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../../discord-bot/services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';

const MATCH_ID = 7;
const LINEUP_ID = 42;

/** Resolves the microtasks a fire-and-forget call leaves behind. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('SchedulingPollEmbedService.fireUpdateEmbed — immediate nudge (ROK-1683)', () => {
  let service: SchedulingPollEmbedService;
  let mockDb: MockDb;
  let enqueue: jest.Mock;
  let emitScheduleChanged: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockDb.limit.mockResolvedValue([{ lineupId: LINEUP_ID }]);
    // The card job never runs: any emit below came from fireUpdateEmbed.
    enqueue = jest.fn(() => new Promise<void>(() => {}));
    emitScheduleChanged = jest.fn();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      providers: [
        SchedulingPollEmbedService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: SchedulingPollEmbedQueueService, useValue: { enqueue } },
        { provide: LineupsGateway, useValue: { emitScheduleChanged } },
        { provide: DiscordEmbedFactory, useValue: {} },
        { provide: DiscordBotClientService, useValue: {} },
        { provide: ChannelResolverService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: NotificationDedupService, useValue: {} },
      ],
    }).compile();
    service = module.get(SchedulingPollEmbedService);
  });

  afterEach(() => warn.mockRestore());

  it('emits schedule-changed for the lineup although the queue never runs', async () => {
    service.fireUpdateEmbed(MATCH_ID);
    await flush();

    expect(emitScheduleChanged).toHaveBeenCalledWith(LINEUP_ID, MATCH_ID);
    expect(emitScheduleChanged).toHaveBeenCalledTimes(1);
  });

  it('still enqueues the Discord card edit exactly once', async () => {
    service.fireUpdateEmbed(MATCH_ID);
    await flush();

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(MATCH_ID);
  });

  it('emits nothing and does not throw when the match row is gone', async () => {
    mockDb.limit.mockResolvedValue([]);

    expect(() => service.fireUpdateEmbed(MATCH_ID)).not.toThrow();
    await flush();

    expect(emitScheduleChanged).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('logs a warning and does not throw when the lookup rejects', async () => {
    mockDb.limit.mockRejectedValue(new Error('db down'));

    expect(() => service.fireUpdateEmbed(MATCH_ID)).not.toThrow();
    await flush();

    expect(emitScheduleChanged).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`match ${MATCH_ID}: db down`),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('logs a warning and does not throw when the emit itself throws', async () => {
    emitScheduleChanged.mockImplementation(() => {
      throw new Error('socket gone');
    });

    expect(() => service.fireUpdateEmbed(MATCH_ID)).not.toThrow();
    await flush();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`match ${MATCH_ID}: socket gone`),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
