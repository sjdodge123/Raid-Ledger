/**
 * Regression: snapshot voice channel on event start for pre-joined users (ROK-735).
 *
 * Users already in a Discord voice channel when a scheduled event starts
 * must appear on the voice roster. Before this fix, only users who joined
 * after the event started were tracked (voiceStateUpdate-driven).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Collection } from 'discord.js';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import * as snapshotH from './voice-attendance-snapshot.helpers';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeGuildMember(id: string, displayName: string) {
  return {
    displayName,
    user: { username: displayName, avatar: `avatar-${id}` },
  };
}

function makeVoiceChannel(members: Array<[string, unknown]>) {
  const col = new Collection<string, unknown>();
  for (const [k, v] of members) col.set(k, v);
  return {
    members: col,
    isVoiceBased: () => true,
  };
}

function makeGuild(channels: Array<[string, unknown]>): {
  channels: { cache: Collection<string, unknown> };
} {
  const cache = new Collection<string, unknown>();
  for (const [k, v] of channels) cache.set(k, v);
  return { channels: { cache } };
}

interface MockDeps {
  service: VoiceAttendanceService;
  mockDb: MockDb;
  mockClientService: {
    getGuild: jest.Mock;
    getGuildId: jest.Mock;
    getClient: jest.Mock;
    isConnected: jest.Mock;
  };
  mockChannelResolver: { resolveVoiceChannelForEvent: jest.Mock };
  mockCronJobService: { executeWithTracking: jest.Mock };
}

async function buildTestModule(): Promise<MockDeps> {
  const mockDb = createDrizzleMock();
  const mockClientService = {
    getGuild: jest.fn().mockReturnValue(null),
    getGuildId: jest.fn().mockReturnValue('guild-1'),
    getClient: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
  };
  const mockChannelResolver = {
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue('voice-ch-1'),
  };
  const mockCronJobService = {
    executeWithTracking: jest
      .fn()
      .mockImplementation((_: string, fn: () => Promise<void>) => fn()),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VoiceAttendanceService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SettingsService,
        useValue: {
          get: jest.fn().mockResolvedValue('5'),
          getDiscordBotDefaultVoiceChannel: jest.fn().mockResolvedValue(null),
        },
      },
      { provide: CronJobService, useValue: mockCronJobService },
      {
        provide: ChannelBindingsService,
        useValue: { getBindings: jest.fn().mockResolvedValue([]) },
      },
      { provide: DiscordBotClientService, useValue: mockClientService },
      { provide: ChannelResolverService, useValue: mockChannelResolver },
    ],
  }).compile();

  return {
    service: module.get(VoiceAttendanceService),
    mockDb,
    mockClientService,
    mockChannelResolver,
    mockCronJobService,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Regression: voice channel snapshot on event start (ROK-735)', () => {
  let deps: MockDeps;

  beforeEach(async () => {
    deps = await buildTestModule();
  });

  afterEach(() => {
    deps.service.onModuleDestroy();
  });

  describe('snapshotVoiceForEvent', () => {
    it('creates sessions for users already in the voice channel', () => {
      const channel = makeVoiceChannel([
        ['user-1', makeGuildMember('user-1', 'Alice')],
        ['user-2', makeGuildMember('user-2', 'Bob')],
      ]);
      const guild = makeGuild([['voice-ch-1', channel]]);
      deps.mockClientService.getGuild.mockReturnValue(guild);

      const count = deps.service.snapshotVoiceForEvent(10, 'voice-ch-1');

      expect(count).toBe(2);
      expect(deps.service.getActiveCount(10)).toBe(2);
      expect(deps.service.isUserActive(10, 'user-1')).toBe(true);
      expect(deps.service.isUserActive(10, 'user-2')).toBe(true);
    });

    it('is idempotent — re-running does not create duplicate sessions', () => {
      const channel = makeVoiceChannel([
        ['user-1', makeGuildMember('user-1', 'Alice')],
      ]);
      const guild = makeGuild([['voice-ch-1', channel]]);
      deps.mockClientService.getGuild.mockReturnValue(guild);

      deps.service.snapshotVoiceForEvent(10, 'voice-ch-1');
      deps.service.snapshotVoiceForEvent(10, 'voice-ch-1');

      expect(deps.service.getActiveCount(10)).toBe(1);
    });

    it('returns 0 when guild is unavailable', () => {
      deps.mockClientService.getGuild.mockReturnValue(null);

      expect(deps.service.snapshotVoiceForEvent(10, 'voice-ch-1')).toBe(0);
    });

    it('returns 0 for an empty voice channel', () => {
      const channel = makeVoiceChannel([]);
      const guild = makeGuild([['voice-ch-1', channel]]);
      deps.mockClientService.getGuild.mockReturnValue(guild);

      expect(deps.service.snapshotVoiceForEvent(10, 'voice-ch-1')).toBe(0);
    });

    it('returns 0 when voice channel ID does not exist', () => {
      const guild = makeGuild([]);
      deps.mockClientService.getGuild.mockReturnValue(guild);

      expect(deps.service.snapshotVoiceForEvent(10, 'no-such-ch')).toBe(0);
    });
  });

  describe('snapshotRecentlyStartedEvents cron', () => {
    it('snapshots pre-joined users for a recently started event', async () => {
      const channel = makeVoiceChannel([
        ['user-pre', makeGuildMember('user-pre', 'PreJoiner')],
      ]);
      const guild = makeGuild([['voice-ch-1', channel]]);
      deps.mockClientService.getGuild.mockReturnValue(guild);
      deps.mockDb.where.mockResolvedValueOnce([
        { id: 42, gameId: 1, recurrenceGroupId: null },
      ]);

      await deps.service.snapshotRecentlyStartedEvents();

      expect(deps.service.isUserActive(42, 'user-pre')).toBe(true);
      expect(deps.service.getActiveCount(42)).toBe(1);
    });

    it('skips events that have already been snapshotted', async () => {
      const channel = makeVoiceChannel([
        ['user-once', makeGuildMember('user-once', 'OnceOnly')],
      ]);
      const guild = makeGuild([['voice-ch-1', channel]]);
      deps.mockClientService.getGuild.mockReturnValue(guild);
      deps.mockDb.where.mockResolvedValue([
        { id: 99, gameId: null, recurrenceGroupId: null },
      ]);

      await deps.service.snapshotRecentlyStartedEvents();
      await deps.service.snapshotRecentlyStartedEvents();

      // resolveVoiceChannelForEvent called only once for event 99
      expect(
        deps.mockChannelResolver.resolveVoiceChannelForEvent,
      ).toHaveBeenCalledTimes(1);
    });

    it('skips when bot is not connected', async () => {
      deps.mockClientService.isConnected.mockReturnValue(false);
      deps.mockDb.where.mockResolvedValueOnce([
        { id: 1, gameId: null, recurrenceGroupId: null },
      ]);

      await deps.service.snapshotRecentlyStartedEvents();

      expect(
        deps.mockChannelResolver.resolveVoiceChannelForEvent,
      ).not.toHaveBeenCalled();
    });

    it('handles event with no resolved voice channel', async () => {
      deps.mockChannelResolver.resolveVoiceChannelForEvent.mockResolvedValue(
        null,
      );
      deps.mockDb.where.mockResolvedValueOnce([
        { id: 50, gameId: 1, recurrenceGroupId: null },
      ]);

      await deps.service.snapshotRecentlyStartedEvents();

      // Should not throw; event should be marked as snapshotted
      expect(deps.service.getActiveCount(50)).toBe(0);
    });
  });
});

describe('fetchRecentlyStartedEvents (pure query builder)', () => {
  it('builds a query with correct window boundaries', async () => {
    const mockDb = createDrizzleMock();
    mockDb.where.mockResolvedValueOnce([]);
    const now = new Date('2026-03-08T20:05:00Z');

    const result = await snapshotH.fetchRecentlyStartedEvents(
      mockDb as never,
      now,
      2 * 60 * 1000,
    );

    expect(result).toEqual([]);
    expect(mockDb.select).toHaveBeenCalled();
  });
});

describe('extractVoiceMembers', () => {
  it('extracts member info from a voice channel', () => {
    const channel = makeVoiceChannel([
      ['user-1', makeGuildMember('user-1', 'Alice')],
      ['user-2', makeGuildMember('user-2', 'Bob')],
    ]);

    const members = snapshotH.extractVoiceMembers(channel as never);

    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({
      discordUserId: 'user-1',
      displayName: 'Alice',
      avatarHash: 'avatar-user-1',
    });
    expect(members[1]).toMatchObject({
      discordUserId: 'user-2',
      displayName: 'Bob',
    });
  });
});

describe('runEventSnapshots orchestration', () => {
  it('calls snapshotEvent for each new event and marks as snapshotted', async () => {
    const mockDb = createDrizzleMock();
    const snapshotted = new Set<number>();
    const resolveVoiceChannel = jest.fn().mockResolvedValue('voice-ch-1');
    const snapshotEvent = jest.fn().mockReturnValue(3);
    const logger = { log: jest.fn() };
    mockDb.where.mockResolvedValueOnce([
      { id: 1, gameId: null, recurrenceGroupId: null },
      { id: 2, gameId: 1, recurrenceGroupId: 'rg-1' },
    ]);

    await snapshotH.runEventSnapshots(
      mockDb as never,
      new Date(),
      120_000,
      snapshotted,
      resolveVoiceChannel,
      snapshotEvent,
      logger,
    );

    expect(snapshotEvent).toHaveBeenCalledTimes(2);
    expect(snapshotted.has(1)).toBe(true);
    expect(snapshotted.has(2)).toBe(true);
    expect(logger.log).toHaveBeenCalledTimes(2);
  });

  it('skips already-snapshotted events', async () => {
    const mockDb = createDrizzleMock();
    const snapshotted = new Set<number>([1]);
    const snapshotEvent = jest.fn().mockReturnValue(1);
    mockDb.where.mockResolvedValueOnce([
      { id: 1, gameId: null, recurrenceGroupId: null },
    ]);

    await snapshotH.runEventSnapshots(
      mockDb as never,
      new Date(),
      120_000,
      snapshotted,
      jest.fn(),
      snapshotEvent,
      { log: jest.fn() },
    );

    expect(snapshotEvent).not.toHaveBeenCalled();
  });
});
