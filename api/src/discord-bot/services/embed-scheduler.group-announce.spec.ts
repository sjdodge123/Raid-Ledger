/**
 * ROK-1832 D6a: a deferred (outside the lead-time window) group-tagged event
 * announces its group when the scheduler finally posts its embed.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { announceDeferredGroupEvent } from './embed-scheduler-announce.helpers';
import { Test, TestingModule } from '@nestjs/testing';
import { EmbedSchedulerService } from './embed-scheduler.service';
import { EmbedPosterService } from './embed-poster.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { GameAffinityNotificationService } from '../../notifications/game-affinity-notification.service';

const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
const MESSAGE = { guildId: 'g1', channelId: 'c1', messageId: 'm1' };

function selectChain(rows: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const k of ['from', 'where', 'leftJoin']) {
    chain[k] = jest.fn().mockReturnValue(chain);
  }
  chain.limit = jest.fn().mockResolvedValue(rows);
  chain.then = (ok: (v: unknown) => void, ko: (e: unknown) => void) =>
    Promise.resolve(rows).then(ok, ko);
  return chain;
}

function deferredEvent(
  guildId: number | null,
  gameId: number | null = null,
): Record<string, unknown> {
  return {
    id: 77,
    title: 'Group Raid',
    description: null,
    duration: [start, end],
    gameId,
    recurrenceRule: null,
    recurrenceGroupId: null,
    notificationChannelOverride: null,
    maxAttendees: null,
    slotConfig: null,
    guildId,
    creatorId: 9,
  };
}

async function build(
  rows: unknown[][],
  posted = true,
): Promise<{ run: () => Promise<void>; notify: jest.Mock }> {
  const select = jest.fn();
  for (const r of rows) select.mockReturnValueOnce(selectChain(r));
  const notify = jest.fn().mockResolvedValue(undefined);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EmbedSchedulerService,
      { provide: DrizzleAsyncProvider, useValue: { select } },
      {
        provide: SettingsService,
        useValue: {
          getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
          getClientUrl: jest.fn().mockResolvedValue('https://rl.test'),
        },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest.fn((_n: string, fn: () => Promise<void>) =>
            fn(),
          ),
        },
      },
      {
        provide: EmbedPosterService,
        useValue: { postEmbed: jest.fn().mockResolvedValue(posted) },
      },
      {
        provide: GameAffinityNotificationService,
        useValue: { notifyGameAffinity: notify },
      },
    ],
  }).compile();
  const service = module.get(EmbedSchedulerService);
  return { run: () => service.handleScheduledEmbeds(), notify };
}

describe('EmbedSchedulerService — deferred group announce (ROK-1832 D6a)', () => {
  it('runs the merged notice plan once when a group-tagged embed posts', async () => {
    const { run, notify } = await build([[deferredEvent(5)], [MESSAGE]]);
    await run();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 77,
        eventTitle: 'Group Raid',
        gameId: null,
        gameName: null,
        creatorId: 9,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        clientUrl: 'https://rl.test',
        discordMessage: MESSAGE,
      }),
    );
  });

  it('stays group-only even when the event has a game (no game-interest fan-out)', async () => {
    const mockDb = createDrizzleMock();
    mockDb.limit.mockResolvedValue([]);
    const notify = jest.fn().mockResolvedValue(undefined);
    await announceDeferredGroupEvent(
      {
        db: mockDb,
        affinity: { notifyGameAffinity: notify },
        clientUrl: () => Promise.resolve('https://rl.test'),
      },
      {
        id: 77,
        title: 'Group Raid',
        duration: [start, end],
        gameId: 42,
        guildId: 5,
        creatorId: 9,
      },
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 77,
        gameId: null,
        gameName: null,
        gameCoverUrl: null,
      }),
    );
  });

  it('does not notify for an untagged deferred event', async () => {
    const { run, notify } = await build([[deferredEvent(null)]]);
    await run();
    expect(notify).not.toHaveBeenCalled();
  });

  it('still announces in-app when the embed post fails (no connected bot — Codex r5)', async () => {
    const { run, notify } = await build([[deferredEvent(5)], []], false);
    await run();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 77, gameId: null, discordMessage: null }),
    );
  });
});
