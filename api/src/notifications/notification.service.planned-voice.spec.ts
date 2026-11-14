/**
 * Notification DMs show a PLANNED temporary voice channel (follow-up to the
 * operator ruling 2026-11-13 / PR #2134): before the channel exists a DM names
 * it and says when it opens instead of linking the game's default voice
 * channel. An event with no planned channel resolves exactly as before.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { DiscordNotificationService } from './discord-notification.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { buildEphemeralChannelName } from '../discord-bot/services/scheduled-event.helpers';

const START = new Date(Date.now() + 3 * 24 * 3_600_000);
const START_ISO = START.toISOString();
const BUFFER_MINUTES = 15;

/** An event row as `resolveVoiceForEvent` selects it. */
function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Stocks 5 man',
    startTime: START_ISO,
    gameId: 7,
    gameName: 'World of Warcraft',
    recurrenceGroupId: null,
    notificationChannelOverride: null,
    ephemeralVoiceChannelId: null,
    ephemeralVoiceEnabled: true,
    cancelledAt: null,
    reschedulingPollId: null,
    ...overrides,
  };
}

function selectChain(rows: unknown[]) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return chain;
}

describe('NotificationService — planned temporary voice channel in DMs', () => {
  let service: NotificationService;
  let db: { select: jest.Mock };
  let resolver: {
    resolveVoiceChannelHonoringOverride: jest.Mock;
    overrideIsVoiceChannel: jest.Mock;
  };
  let settings: Record<string, jest.Mock>;

  beforeEach(async () => {
    db = { select: jest.fn() };
    resolver = {
      resolveVoiceChannelHonoringOverride: jest
        .fn()
        .mockResolvedValue('default-voice-1'),
      overrideIsVoiceChannel: jest.fn().mockReturnValue(false),
    };
    settings = {
      getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(true),
      getEphemeralVoiceForced: jest.fn().mockResolvedValue(false),
      getEphemeralVoiceCreateBufferMinutes: jest
        .fn()
        .mockResolvedValue(BUFFER_MINUTES),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: DrizzleAsyncProvider, useValue: db },
        { provide: DiscordNotificationService, useValue: null },
        { provide: ChannelResolverService, useValue: resolver },
        { provide: SettingsService, useValue: settings },
        { provide: CronJobService, useValue: { executeWithTracking: jest.fn() } },
      ],
    }).compile();
    service = module.get(NotificationService);
  });

  it('a planned channel yields its name + open time, not the default link', async () => {
    db.select.mockReturnValue(selectChain([eventRow()]));
    const voice = await service.resolveVoiceForEvent(42);
    const expectedName = buildEphemeralChannelName({
      title: 'Stocks 5 man',
      game: { name: 'World of Warcraft' },
      startTime: START_ISO,
      endTime: START_ISO,
      signupCount: 0,
    });
    const opensAt = new Date(START.getTime() - BUFFER_MINUTES * 60_000);
    expect(voice).toEqual({
      plannedVoiceChannel: { name: expectedName, opensAt: opensAt.toISOString() },
    });
  });

  it('resolveVoiceChannelForEvent no longer links the default channel while planned', async () => {
    db.select.mockReturnValue(selectChain([eventRow()]));
    await expect(service.resolveVoiceChannelForEvent(42)).resolves.toBeNull();
  });

  it('an event with no planned channel keeps the resolved voice link', async () => {
    db.select.mockReturnValue(
      selectChain([eventRow({ ephemeralVoiceEnabled: false })]),
    );
    settings.getEphemeralVoiceEnabled?.mockResolvedValue(false);
    await expect(service.resolveVoiceForEvent(42)).resolves.toEqual({
      voiceChannelId: 'default-voice-1',
    });
    await expect(service.resolveVoiceChannelForEvent(42)).resolves.toBe(
      'default-voice-1',
    );
  });

  it('a live temporary channel is linked, never planned', async () => {
    db.select.mockReturnValue(
      selectChain([eventRow({ ephemeralVoiceChannelId: 'temp-9' })]),
    );
    resolver.resolveVoiceChannelHonoringOverride.mockResolvedValue('temp-9');
    await expect(service.resolveVoiceForEvent(42)).resolves.toEqual({
      voiceChannelId: 'temp-9',
    });
    expect(resolver.resolveVoiceChannelHonoringOverride).toHaveBeenCalledWith(
      7,
      null,
      'temp-9',
      null,
    );
  });

  it('a missing event resolves to no voice at all', async () => {
    db.select.mockReturnValue(selectChain([]));
    await expect(service.resolveVoiceForEvent(42)).resolves.toEqual({});
  });
});
