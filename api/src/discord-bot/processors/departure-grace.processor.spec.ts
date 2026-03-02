import { DepartureGraceProcessor } from './departure-grace.processor';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { NotificationService } from '../../notifications/notification.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SIGNUP_EVENTS } from '../discord-bot.constants';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  createMockEvent,
  createMockSignup,
} from '../../common/testing/factories';
import type { Job } from 'bullmq';
import type { DepartureGraceJobData } from '../queues/departure-grace.queue';

function makeJob(data: DepartureGraceJobData) {
  return { data } as Job<DepartureGraceJobData>;
}

describe('DepartureGraceProcessor', () => {
  let processor: DepartureGraceProcessor;
  let mockDb: MockDb;
  let mockVoiceAttendanceService: { isUserActive: jest.Mock };
  let mockNotificationService: {
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
    create: jest.Mock;
  };
  let mockClientService: {
    isConnected: jest.Mock;
    sendEmbedDM: jest.Mock;
  };
  let mockEventEmitter: { emit: jest.Mock };

  const jobData: DepartureGraceJobData = {
    eventId: 1,
    discordUserId: 'discord-user-abc',
    signupId: 10,
  };

  const liveEvent = createMockEvent({
    id: 1,
    isAdHoc: false,
    cancelledAt: null,
    creatorId: 99,
    title: 'Test Raid',
  });

  const activeSignup = createMockSignup({
    id: 10,
    eventId: 1,
    status: 'signed_up',
    discordUserId: 'discord-user-abc',
    discordUsername: 'RaidMember',
    userId: 5,
  });

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockVoiceAttendanceService = {
      isUserActive: jest.fn().mockReturnValue(false),
    };
    mockNotificationService = {
      getDiscordEmbedUrl: jest
        .fn()
        .mockResolvedValue('https://discord.com/embed/1'),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue('channel-123'),
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockClientService = {
      isConnected: jest.fn().mockReturnValue(true),
      sendEmbedDM: jest.fn().mockResolvedValue(undefined),
    };
    mockEventEmitter = { emit: jest.fn() };

    processor = new DepartureGraceProcessor(
      mockDb as never,
      mockVoiceAttendanceService as unknown as VoiceAttendanceService,
      mockNotificationService as unknown as NotificationService,
      mockClientService as unknown as DiscordBotClientService,
      mockEventEmitter as unknown as EventEmitter2,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Guard: user rejoined voice before grace expired ──────────────────────

  describe('guard: user active in voice', () => {
    it('skips departure processing if user returned to voice before grace expired', async () => {
      mockVoiceAttendanceService.isUserActive.mockReturnValue(true);

      await processor.process(makeJob(jobData));

      // No DB queries for event lookup should happen
      expect(mockDb.limit).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('checks isUserActive with correct eventId and discordUserId', async () => {
      mockVoiceAttendanceService.isUserActive.mockReturnValue(true);

      await processor.process(makeJob(jobData));

      expect(mockVoiceAttendanceService.isUserActive).toHaveBeenCalledWith(
        jobData.eventId,
        jobData.discordUserId,
      );
    });
  });

  // ─── Guard: event no longer live ──────────────────────────────────────────

  describe('guard: event no longer live', () => {
    it('skips departure if event is not found / no longer live', async () => {
      // First limit call returns no event (event ended or cancelled)
      mockDb.limit.mockResolvedValueOnce([]);

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // ─── Guard: signup not found ───────────────────────────────────────────────

  describe('guard: signup not found', () => {
    it('skips departure if signup record no longer exists', async () => {
      mockDb.limit
        .mockResolvedValueOnce([liveEvent]) // event query
        .mockResolvedValueOnce([]); // signup query — not found

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // ─── Guard: signup status not actionable ──────────────────────────────────

  describe('guard: signup status', () => {
    it.each(['departed', 'declined', 'roached_out'])(
      'skips departure if signup status is already "%s"',
      async (status) => {
        const signup = createMockSignup({ id: 10, eventId: 1, status });
        mockDb.limit
          .mockResolvedValueOnce([liveEvent])
          .mockResolvedValueOnce([signup]);

        await processor.process(makeJob(jobData));

        expect(mockNotificationService.create).not.toHaveBeenCalled();
        expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      },
    );

    it('processes departure for signed_up status', async () => {
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([]) // roster assignment query
        .mockResolvedValueOnce([]); // display name user query (no userId match needed)

      await processor.process(makeJob(jobData));

      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('processes departure for tentative status', async () => {
      const tentativeSignup = createMockSignup({
        id: 10,
        eventId: 1,
        status: 'tentative',
        discordUsername: 'TentativeUser',
      });
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([tentativeSignup])
        .mockResolvedValueOnce([]) // roster assignment
        .mockResolvedValueOnce([]); // display name user query

      await processor.process(makeJob(jobData));

      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });
  });

  // ─── Core flow: successful departure ──────────────────────────────────────

  describe('successful departure flow', () => {
    beforeEach(() => {
      // Default: user not active, event live, signup active, no roster assignment
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([]); // roster assignment — none
    });

    it('updates signup status to "departed"', async () => {
      await processor.process(makeJob(jobData));

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({ status: 'departed' });
    });

    it('sends a slot_vacated notification to the event creator', async () => {
      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: liveEvent.creatorId,
          type: 'slot_vacated',
          title: 'Member Departed',
        }),
      );
    });

    it('includes the member display name in the notification message', async () => {
      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('RaidMember'),
        }),
      );
    });

    it('includes eventId in the notification payload', async () => {
      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ eventId: jobData.eventId }),
        }),
      );
    });

    it('emits SIGNUP_EVENTS.UPDATED with "departed" action for embed sync', async () => {
      await processor.process(makeJob(jobData));

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SIGNUP_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: jobData.eventId,
          signupId: jobData.signupId,
          action: 'departed',
        }),
      );
    });

    it('does not send promote DM when no roster assignment exists', async () => {
      await processor.process(makeJob(jobData));

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('does not send notification when event has no creatorId', async () => {
      const eventWithNoCreator = createMockEvent({ id: 1, creatorId: null });
      mockDb.limit
        .mockReset()
        .mockResolvedValueOnce([eventWithNoCreator])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([]); // roster assignment

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      // But the event emit still happens
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });
  });

  // ─── Roster slot freeing ──────────────────────────────────────────────────

  describe('roster slot freeing', () => {
    /**
     * Helper: set up mock chain for the full departure flow with a roster assignment.
     * The processor queries: event(.limit), signup(.limit), update-status(.where),
     * assignment(.limit), bench-slots(.where), update-assignment(.where).
     * The bench-slots query terminates at .where() (no .limit), so we override
     * .where on the 5th call to resolve to an array.
     */
    beforeEach(() => {
      // These tests focus on roster slot movement, not DM behavior.
      // Disconnect the bot so sendCreatorPromoteDM exits early.
      mockClientService.isConnected.mockReturnValue(false);
    });

    function setupRosterMocks(assignment: Record<string, unknown>) {
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([assignment]);

      // .where calls: 1=event, 2=signup, 3=update-status, 4=assignment, 5=bench-slots(terminal), 6=update-assignment
      let whereCallCount = 0;
      const originalWhere = mockDb.where;
      mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
        whereCallCount++;
        if (whereCallCount === 5) {
          // bench slots query — terminal, resolve to empty array
          return Promise.resolve([]);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return originalWhere.call(this);
      });
    }

    it('moves the roster assignment to bench when one exists', async () => {
      const assignment = {
        id: 55,
        role: 'tank',
        position: 1,
        signupId: 10,
        eventId: 1,
      };
      setupRosterMocks(assignment);

      await processor.process(makeJob(jobData));

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'bench', position: 1 }),
      );
    });

    it('places departed user at next bench position after existing bench members', async () => {
      const assignment = {
        id: 55,
        role: 'tank',
        position: 1,
        signupId: 10,
        eventId: 1,
      };
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([assignment]);

      let whereCallCount = 0;
      const originalWhere = mockDb.where;
      mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
        whereCallCount++;
        if (whereCallCount === 5) {
          // Existing bench members at positions 1 and 2
          return Promise.resolve([{ position: 1 }, { position: 2 }]);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return originalWhere.call(this);
      });

      await processor.process(makeJob(jobData));

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'bench', position: 3 }),
      );
    });
  });

  // ─── Discord DM to creator ────────────────────────────────────────────────

  describe('creator promote DM', () => {
    function setupWithRoster(assignment: Record<string, unknown>) {
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([assignment]);

      let whereCallCount = 0;
      const originalWhere = mockDb.where;
      mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
        whereCallCount++;
        if (whereCallCount === 5) {
          // bench slots query
          return Promise.resolve([]);
        }
        // Bench player check for DM (returns bench players in .orderBy chain)
        if (whereCallCount === 7) {
          // Query chain for bench players: .where → .orderBy → .limit
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return originalWhere.call(this);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return originalWhere.call(this);
      });
    }

    it('sends Discord DM when roster slot is vacated and bench players exist', async () => {
      const assignment = {
        id: 55,
        role: 'dps',
        position: 2,
        signupId: 10,
        eventId: 1,
      };
      setupWithRoster(assignment);

      // Bench player check: returns a bench player
      mockDb.limit
        .mockResolvedValueOnce([{ id: 88 }]) // bench players exist
        .mockResolvedValueOnce([{ discordId: 'creator-discord-123' }]); // creator lookup

      await processor.process(makeJob(jobData));

      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        'creator-discord-123',
        expect.anything(), // EmbedBuilder
        expect.anything(), // ActionRowBuilder
      );
    });

    it('does NOT send DM when bot is not connected', async () => {
      mockClientService.isConnected.mockReturnValue(false);
      const assignment = {
        id: 55,
        role: 'dps',
        position: 2,
        signupId: 10,
        eventId: 1,
      };
      setupWithRoster(assignment);

      await processor.process(makeJob(jobData));

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('does NOT send DM when bench slot assignment (not a vacated role slot)', async () => {
      const benchAssignment = {
        id: 56,
        role: 'bench',
        position: 1,
        signupId: 10,
        eventId: 1,
      };
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([benchAssignment]);

      await processor.process(makeJob(jobData));

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('does NOT send DM when no bench players exist', async () => {
      const assignment = {
        id: 55,
        role: 'tank',
        position: 1,
        signupId: 10,
        eventId: 1,
      };
      setupWithRoster(assignment);

      // Bench player check: none found
      mockDb.limit.mockResolvedValueOnce([]);

      await processor.process(makeJob(jobData));

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('does NOT send DM when creator has no Discord ID', async () => {
      const assignment = {
        id: 55,
        role: 'tank',
        position: 1,
        signupId: 10,
        eventId: 1,
      };
      setupWithRoster(assignment);

      mockDb.limit
        .mockResolvedValueOnce([{ id: 88 }]) // bench players exist
        .mockResolvedValueOnce([{ discordId: null }]); // creator has no discord

      await processor.process(makeJob(jobData));

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('does not throw if DM fails (failure is non-blocking)', async () => {
      const assignment = {
        id: 55,
        role: 'tank',
        position: 1,
        signupId: 10,
        eventId: 1,
      };
      setupWithRoster(assignment);

      mockDb.limit
        .mockResolvedValueOnce([{ id: 88 }])
        .mockResolvedValueOnce([{ discordId: 'creator-discord-123' }]);
      mockClientService.sendEmbedDM.mockRejectedValue(new Error('DM blocked'));

      // Should not throw
      await expect(
        processor.process(makeJob(jobData)),
      ).resolves.toBeUndefined();
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });
  });

  // ─── Display name resolution ───────────────────────────────────────────────

  describe('display name resolution', () => {
    it('uses discordUsername from signup when available', async () => {
      const signupWithUsername = createMockSignup({
        id: 10,
        eventId: 1,
        status: 'signed_up',
        discordUsername: 'DiscordName',
        userId: null,
      });
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([signupWithUsername])
        .mockResolvedValueOnce([]); // no roster

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('DiscordName'),
        }),
      );
    });

    it('falls back to RL username when discordUsername is null', async () => {
      const signupWithoutDiscordName = createMockSignup({
        id: 10,
        eventId: 1,
        status: 'signed_up',
        discordUsername: null,
        userId: 5,
      });
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([signupWithoutDiscordName])
        .mockResolvedValueOnce([]) // no roster
        .mockResolvedValueOnce([{ username: 'RLUser' }]); // user lookup

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('RLUser'),
        }),
      );
    });

    it('falls back to discordUserId when both discordUsername and userId are absent', async () => {
      const anonymousSignup = createMockSignup({
        id: 10,
        eventId: 1,
        status: 'signed_up',
        discordUsername: null,
        userId: null,
        discordUserId: 'raw-discord-id-xyz',
      });
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([anonymousSignup])
        .mockResolvedValueOnce([]); // no roster

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('raw-discord-id-xyz'),
        }),
      );
    });

    it('falls back to "Unknown" when no name info is available', async () => {
      const blankSignup = createMockSignup({
        id: 10,
        eventId: 1,
        status: 'signed_up',
        discordUsername: null,
        userId: null,
        discordUserId: null,
      });
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([blankSignup])
        .mockResolvedValueOnce([]); // no roster

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Unknown'),
        }),
      );
    });
  });

  // ─── Notification includes optional URLs ──────────────────────────────────

  describe('notification payload URLs', () => {
    beforeEach(() => {
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([activeSignup])
        .mockResolvedValueOnce([]); // no roster
    });

    it('includes discordUrl in payload when available', async () => {
      mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(
        'https://discord.com/embed',
      );

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            discordUrl: 'https://discord.com/embed',
          }),
        }),
      );
    });

    it('omits discordUrl from payload when not available', async () => {
      mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(null);
      mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
        null,
      );

      await processor.process(makeJob(jobData));

      const payload = mockNotificationService.create.mock.calls[0][0].payload;
      expect(payload).not.toHaveProperty('discordUrl');
    });

    it('includes voiceChannelId in payload when available', async () => {
      mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
        'vc-999',
      );

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ voiceChannelId: 'vc-999' }),
        }),
      );
    });

    it('omits voiceChannelId from payload when not available', async () => {
      mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(null);
      mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
        null,
      );

      await processor.process(makeJob(jobData));

      const payload = mockNotificationService.create.mock.calls[0][0].payload;
      expect(payload).not.toHaveProperty('voiceChannelId');
    });
  });
});
