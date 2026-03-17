/**
 * Tests for voice-based reminder suppression in EventReminderService (ROK-842).
 *
 * AC 4: User IS active in voice → reminder NOT sent
 * AC 5: VoiceAttendanceService is null → reminder IS sent (graceful degradation)
 * AC 6: User has no discordId → reminder IS sent
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventReminderService } from './event-reminder.service';
import { NotificationService } from './notification.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { RoleGapAlertService } from './role-gap-alert.service';

/** Build a select chain where .from().where() is the terminal. */
function makeSelectFromWhere(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

/** Build a dedup insert chain that always succeeds (no conflict). */
function makeInsertChain(rows: unknown[] = [{ id: 1 }]) {
  return {
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

/** Shared event starting soon (10 min from now). */
function makeSoonEvent() {
  const now = new Date();
  const start = new Date(now.getTime() + 10 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    id: 42,
    title: 'Raid Night',
    duration: [start, end] as [Date, Date],
    gameId: null,
    reminder15min: true,
    reminder1hour: false,
    reminder24hour: false,
    cancelledAt: null,
  };
}

/** Wire up mockDb for a full handleReminders() run with two signed-up users. */
function wireHandleRemindersDb(
  mockDb: Record<string, jest.Mock>,
  options: {
    users: { id: number; discordId: string | null }[];
    eventId?: number;
  },
) {
  const { users, eventId = 42 } = options;
  const signups = users.map((u) => ({ eventId, userId: u.id }));

  mockDb.select
    // 1. fetchCandidateEvents
    .mockReturnValueOnce(makeSelectFromWhere([makeSoonEvent()]))
    // 2. fetchSignupsByEvent
    .mockReturnValueOnce(makeSelectFromWhere(signups))
    // 3. fetchUserMap
    .mockReturnValueOnce(makeSelectFromWhere(users))
    // 4. fetchUserTimezones
    .mockReturnValueOnce(makeSelectFromWhere([]))
    // 5. fetchCharactersByUser
    .mockReturnValueOnce(makeSelectFromWhere([]));
}

/** Build and return a module with an optional VoiceAttendanceService. */
async function buildModule(opts: {
  mockDb: Record<string, jest.Mock>;
  mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  voiceAttendance?: { isUserActive: jest.Mock } | null;
}): Promise<EventReminderService> {
  const providers: unknown[] = [
    EventReminderService,
    { provide: DrizzleAsyncProvider, useValue: opts.mockDb },
    { provide: NotificationService, useValue: opts.mockNotificationService },
    {
      provide: CronJobService,
      useValue: {
        executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
          fn(),
        ),
      },
    },
    {
      provide: SettingsService,
      useValue: {
        getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
        getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      },
    },
    {
      provide: RoleGapAlertService,
      useValue: { checkRoleGaps: jest.fn().mockResolvedValue(undefined) },
    },
  ];

  if (opts.voiceAttendance !== undefined && opts.voiceAttendance !== null) {
    providers.push({
      provide: VoiceAttendanceService,
      useValue: opts.voiceAttendance,
    });
  }
  // When null, VoiceAttendanceService is NOT provided — @Optional() resolves to null.

  const module: TestingModule = await Test.createTestingModule({
    providers: providers as Parameters<
      typeof Test.createTestingModule
    >[0]['providers'],
  }).compile();

  return module.get<EventReminderService>(EventReminderService);
}

describe('EventReminderService — voice suppression (ROK-842)', () => {
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };

  beforeEach(() => {
    mockDb = { select: jest.fn(), insert: jest.fn(), delete: jest.fn() };

    mockNotificationService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --- AC 4: user is in voice → reminder suppressed ---

  describe('AC4: active voice user does not receive reminder', () => {
    it('suppresses reminder when isUserActive returns true', async () => {
      const mockVoice = { isUserActive: jest.fn().mockReturnValue(true) };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [{ id: 1, discordId: 'discord-1' }],
      });
      mockDb.insert.mockReturnValue(makeInsertChain());

      await service.handleReminders();

      expect(mockVoice.isUserActive).toHaveBeenCalledWith(42, 'discord-1');
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('calls isUserActive with the correct eventId and discordId', async () => {
      const mockVoice = { isUserActive: jest.fn().mockReturnValue(true) };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [{ id: 7, discordId: 'discord-7' }],
        eventId: 42,
      });

      await service.handleReminders();

      expect(mockVoice.isUserActive).toHaveBeenCalledWith(42, 'discord-7');
    });
  });

  // --- AC 4 continued: user NOT in voice → reminder IS sent ---

  describe('AC4: inactive voice user receives reminder', () => {
    it('sends reminder when isUserActive returns false', async () => {
      const mockVoice = { isUserActive: jest.fn().mockReturnValue(false) };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [{ id: 2, discordId: 'discord-2' }],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 2, type: 'event_reminder' }),
      );
    });
  });

  // --- AC 4 edge: mixed users — some in voice, some not ---

  describe('AC4 edge: partial voice suppression', () => {
    it('only sends reminder to user NOT in voice when one is in voice and one is not', async () => {
      const mockVoice = {
        isUserActive: jest
          .fn()
          .mockImplementation((_eventId: number, discordId: string) => {
            return discordId === 'discord-in-voice';
          }),
      };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [
          { id: 10, discordId: 'discord-in-voice' },
          { id: 11, discordId: 'discord-not-in-voice' },
        ],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 11 }),
      );
      expect(mockNotificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: 10 }),
      );
    });

    it('sends no reminders when all users are in voice', async () => {
      const mockVoice = { isUserActive: jest.fn().mockReturnValue(true) };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [
          { id: 10, discordId: 'discord-10' },
          { id: 11, discordId: 'discord-11' },
        ],
      });

      await service.handleReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('sends reminders to all users when none are in voice', async () => {
      const mockVoice = { isUserActive: jest.fn().mockReturnValue(false) };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [
          { id: 10, discordId: 'discord-10' },
          { id: 11, discordId: 'discord-11' },
        ],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });
  });

  // --- AC 5: VoiceAttendanceService not injected → send reminder anyway ---

  describe('AC5: graceful degradation when VoiceAttendanceService is null', () => {
    it('sends reminder even when VoiceAttendanceService is not provided', async () => {
      // Build module WITHOUT providing VoiceAttendanceService
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: null,
      });

      wireHandleRemindersDb(mockDb, {
        users: [{ id: 3, discordId: 'discord-3' }],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 3, type: 'event_reminder' }),
      );
    });

    it('sends reminders to multiple users when voice service is absent', async () => {
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: null,
      });

      wireHandleRemindersDb(mockDb, {
        users: [
          { id: 20, discordId: 'discord-20' },
          { id: 21, discordId: 'discord-21' },
        ],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });
  });

  // --- AC 6: user has no discordId → send reminder anyway ---

  describe('AC6: user without discordId still receives reminder', () => {
    it('sends reminder when user has null discordId', async () => {
      const mockVoice = { isUserActive: jest.fn().mockReturnValue(false) };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [{ id: 5, discordId: null }],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockVoice.isUserActive).not.toHaveBeenCalled();
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 5, type: 'event_reminder' }),
      );
    });

    it('does not call isUserActive when discordId is null', async () => {
      const mockVoice = { isUserActive: jest.fn() };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [{ id: 6, discordId: null }],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockVoice.isUserActive).not.toHaveBeenCalled();
    });

    it('sends reminders to both discord and non-discord users', async () => {
      const mockVoice = { isUserActive: jest.fn().mockReturnValue(false) };
      const service = await buildModule({
        mockDb,
        mockNotificationService,
        voiceAttendance: mockVoice,
      });

      wireHandleRemindersDb(mockDb, {
        users: [
          { id: 30, discordId: 'discord-30' },
          { id: 31, discordId: null },
        ],
      });
      mockDb.insert.mockReturnValue(makeInsertChain([{ id: 1 }]));

      await service.handleReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 30 }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 31 }),
      );
    });
  });
});
