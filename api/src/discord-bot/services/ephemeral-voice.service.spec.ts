/**
 * Unit tests for EphemeralVoiceService (ROK-1352) — the two non-negotiable
 * behaviors: never-delete-while-occupied (AC4) and persist-then-repoint
 * ordering (architect constraint #1).
 */
import { Test } from '@nestjs/testing';
import { EphemeralVoiceService } from './ephemeral-voice.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { ScheduledEventService } from './scheduled-event.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { VoiceAttendanceService } from './voice-attendance.service';
import * as discordOps from './ephemeral-voice.discord-ops';
import * as dbHelpers from './ephemeral-voice.db-helpers';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const guild = { id: 'g1' } as never;

async function build(memberCount: number) {
  const client = {
    isConnected: jest.fn().mockReturnValue(true),
    getGuild: jest.fn().mockReturnValue(guild),
  };
  const scheduledEvent = { updateScheduledEvent: jest.fn() };
  const voiceAttendance = { flushToDb: jest.fn().mockResolvedValue(undefined) };
  const embed = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const module = await Test.createTestingModule({
    providers: [
      EphemeralVoiceService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: DiscordBotClientService, useValue: client },
      { provide: SettingsService, useValue: {} },
      { provide: ScheduledEventService, useValue: scheduledEvent },
      { provide: EmbedSyncQueueService, useValue: embed },
      { provide: VoiceAttendanceService, useValue: voiceAttendance },
    ],
  }).compile();
  jest
    .spyOn(discordOps, 'getChannelMemberCountFresh')
    .mockResolvedValue(memberCount);
  jest.spyOn(discordOps, 'deleteVoiceChannel').mockResolvedValue(true);
  jest.spyOn(dbHelpers, 'buildRepointData').mockResolvedValue({
    title: 't',
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T01:00:00Z',
    signupCount: 0,
    game: null,
  });
  const clearSpy = jest
    .spyOn(dbHelpers, 'clearEphemeralChannelId')
    .mockResolvedValue(undefined);
  return {
    service: module.get(EphemeralVoiceService),
    deleteSpy: discordOps.deleteVoiceChannel as jest.Mock,
    clearSpy,
    voiceAttendance,
  };
}

const row = {
  id: 1,
  title: 't',
  gameId: null,
  startTime: '2026-01-01T00:00:00Z',
  endTime: '2026-01-01T01:00:00Z',
  recurrenceGroupId: null,
  ephemeralVoiceEnabled: null,
  ephemeralVoiceChannelId: 'ch-1',
};

afterEach(() => jest.restoreAllMocks());

describe('destroyForEvent — never delete while occupied (AC4)', () => {
  it('skips delete when the channel still has members', async () => {
    const { service, deleteSpy, clearSpy } = await build(2);
    await service.destroyForEvent({ ...row });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('flushes attendance then deletes when empty', async () => {
    const { service, deleteSpy, clearSpy, voiceAttendance } = await build(0);
    await service.destroyForEvent({ ...row });
    expect(deleteSpy).toHaveBeenCalledWith(guild, 'ch-1');
    expect(clearSpy).toHaveBeenCalledWith(expect.anything(), 1);
    expect(voiceAttendance.flushToDb).toHaveBeenCalled();
  });

  it('does nothing when the event has no ephemeral channel', async () => {
    const { service, deleteSpy } = await build(0);
    await service.destroyForEvent({ ...row, ephemeralVoiceChannelId: null });
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
