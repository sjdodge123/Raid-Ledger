/**
 * Unit tests for the EphemeralVoiceScheduler name-reconcile scan (the deploy
 * backfill / self-heal pass over in-flight ephemeral events).
 */
import { Test } from '@nestjs/testing';
import { EphemeralVoiceScheduler } from './ephemeral-voice.scheduler';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { EphemeralVoiceService } from './ephemeral-voice.service';
import * as dbHelpers from './ephemeral-voice.db-helpers';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

async function build(connected: boolean) {
  const client = { isConnected: jest.fn().mockReturnValue(connected) };
  const ephemeralVoice = {
    reconcileNamesForEvent: jest.fn().mockResolvedValue(undefined),
  };
  const module = await Test.createTestingModule({
    providers: [
      EphemeralVoiceScheduler,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: DiscordBotClientService, useValue: client },
      { provide: SettingsService, useValue: {} },
      { provide: CronJobService, useValue: {} },
      { provide: EphemeralVoiceService, useValue: ephemeralVoice },
    ],
  }).compile();
  return { scheduler: module.get(EphemeralVoiceScheduler), ephemeralVoice };
}

afterEach(() => jest.restoreAllMocks());

const candidate = {
  id: 1,
  title: 't',
  gameId: null,
  startTime: '2026-01-01T00:00:00Z',
  endTime: '2026-01-01T01:00:00Z',
  recurrenceGroupId: null,
  ephemeralVoiceEnabled: null,
  ephemeralVoiceChannelId: 'ch-1',
  privateVoice: null,
  discordScheduledEventId: 'se-1',
};

describe('scanNameReconcile', () => {
  it('returns false and does not query when the bot is not connected', async () => {
    const { scheduler, ephemeralVoice } = await build(false);
    const findSpy = jest.spyOn(dbHelpers, 'findNameReconcileCandidates');
    expect(await scheduler.scanNameReconcile()).toBe(false);
    expect(findSpy).not.toHaveBeenCalled();
    expect(ephemeralVoice.reconcileNamesForEvent).not.toHaveBeenCalled();
  });

  it('reconciles names for every in-flight candidate', async () => {
    const { scheduler, ephemeralVoice } = await build(true);
    jest
      .spyOn(dbHelpers, 'findNameReconcileCandidates')
      .mockResolvedValue([candidate, { ...candidate, id: 2 }]);
    await scheduler.scanNameReconcile();
    expect(ephemeralVoice.reconcileNamesForEvent).toHaveBeenCalledTimes(2);
    expect(ephemeralVoice.reconcileNamesForEvent).toHaveBeenCalledWith(
      candidate,
    );
  });

  it('swallows a scan error without throwing', async () => {
    const { scheduler, ephemeralVoice } = await build(true);
    jest
      .spyOn(dbHelpers, 'findNameReconcileCandidates')
      .mockRejectedValue(new Error('db down'));
    await expect(scheduler.scanNameReconcile()).resolves.toBeUndefined();
    expect(ephemeralVoice.reconcileNamesForEvent).not.toHaveBeenCalled();
  });
});
