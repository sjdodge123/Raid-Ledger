import { Test, TestingModule } from '@nestjs/testing';
import { AdHocEventService } from './ad-hoc-event.service';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { SettingsService } from '../../settings/settings.service';
import { UsersService } from '../../users/users.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';
import { SETTING_KEYS } from '../../drizzle/schema';

describe('AdHocEventService', () => {
  let service: AdHocEventService;
  let mockDb: MockDb;
  let mockSettingsService: {
    get: jest.Mock;
  };
  let mockParticipantService: {
    addParticipant: jest.Mock;
    markLeave: jest.Mock;
    getRoster: jest.Mock;
    getActiveCount: jest.Mock;
    finalizeAll: jest.Mock;
  };
  let mockChannelBindingsService: {
    getBindingById: jest.Mock;
    getBindings: jest.Mock;
  };
  let mockUsersService: {
    findByDiscordId: jest.Mock;
  };
  let mockGracePeriodQueue: {
    enqueue: jest.Mock;
    cancel: jest.Mock;
  };

  const baseMember = {
    discordUserId: 'discord-123',
    discordUsername: 'TestPlayer',
    discordAvatarHash: 'avatar-hash',
    userId: 1,
  };

  const baseBinding = {
    gameId: 1,
    config: {
      minPlayers: 2,
      gracePeriod: 5,
      notificationChannelId: 'channel-notif',
    },
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    mockSettingsService = {
      get: jest.fn(),
    };

    mockParticipantService = {
      addParticipant: jest.fn().mockResolvedValue(undefined),
      markLeave: jest.fn().mockResolvedValue(undefined),
      getRoster: jest.fn().mockResolvedValue([]),
      getActiveCount: jest.fn().mockResolvedValue(0),
      finalizeAll: jest.fn().mockResolvedValue(undefined),
    };

    mockChannelBindingsService = {
      getBindingById: jest.fn(),
      getBindings: jest.fn(),
    };

    mockUsersService = {
      findByDiscordId: jest.fn(),
    };

    mockGracePeriodQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdHocEventService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: AdHocParticipantService, useValue: mockParticipantService },
        { provide: ChannelBindingsService, useValue: mockChannelBindingsService },
        { provide: AdHocGracePeriodQueueService, useValue: mockGracePeriodQueue },
      ],
    }).compile();

    service = module.get(AdHocEventService);
  });

  describe('isEnabled', () => {
    it('returns true when setting is "true"', async () => {
      mockSettingsService.get.mockResolvedValue('true');

      const result = await service.isEnabled();

      expect(result).toBe(true);
      expect(mockSettingsService.get).toHaveBeenCalledWith(
        SETTING_KEYS.AD_HOC_EVENTS_ENABLED,
      );
    });

    it('returns false when setting is not "true"', async () => {
      mockSettingsService.get.mockResolvedValue('false');

      const result = await service.isEnabled();

      expect(result).toBe(false);
    });

    it('returns false when setting is null', async () => {
      mockSettingsService.get.mockResolvedValue(null);

      const result = await service.isEnabled();

      expect(result).toBe(false);
    });
  });

  describe('handleVoiceJoin', () => {
    it('does nothing when feature is disabled', async () => {
      mockSettingsService.get.mockResolvedValue('false');

      await service.handleVoiceJoin('binding-1', baseMember, baseBinding);

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockParticipantService.addParticipant).not.toHaveBeenCalled();
    });

    it('creates a new ad-hoc event when no active event exists', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      // createAdHocEvent: admin lookup not needed since userId is provided
      // game name lookup
      mockDb.limit.mockResolvedValueOnce([{ name: 'World of Warcraft' }]);
      // event insert
      mockDb.returning.mockResolvedValueOnce([{ id: 100 }]);

      await service.handleVoiceJoin('binding-1', baseMember, baseBinding);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockParticipantService.addParticipant).toHaveBeenCalledWith(
        100,
        baseMember,
      );
    });

    it('creates event with "Gaming" title when no game is bound', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      const noGameBinding = { ...baseBinding, gameId: null };
      mockDb.returning.mockResolvedValueOnce([{ id: 101 }]);

      await service.handleVoiceJoin('binding-2', baseMember, noGameBinding);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Gaming — Ad-Hoc Session',
        }),
      );
    });

    it('falls back to admin user when member has no linked account', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      const anonymousMember = { ...baseMember, userId: null };
      // First limit: admin user lookup
      mockDb.limit.mockResolvedValueOnce([{ id: 99 }]);
      // Second limit: game name lookup
      mockDb.limit.mockResolvedValueOnce([{ name: 'FFXIV' }]);
      // Insert returning
      mockDb.returning.mockResolvedValueOnce([{ id: 102 }]);

      await service.handleVoiceJoin('binding-3', anonymousMember, baseBinding);

      expect(mockDb.returning).toHaveBeenCalled();
      expect(mockParticipantService.addParticipant).toHaveBeenCalledWith(
        102,
        anonymousMember,
      );
    });

    it('returns null when no admin found and no linked user', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      const anonymousMember = { ...baseMember, userId: null };
      // Admin lookup: empty
      mockDb.limit.mockResolvedValueOnce([]);

      await service.handleVoiceJoin('binding-4', anonymousMember, baseBinding);

      expect(mockDb.returning).not.toHaveBeenCalled();
      expect(mockParticipantService.addParticipant).not.toHaveBeenCalled();
    });

    it('adds joiner to existing live event and cancels grace period', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      // First create an event
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 200 }]);
      await service.handleVoiceJoin('binding-5', baseMember, baseBinding);

      // Second join to same binding
      mockSettingsService.get.mockResolvedValue('true');
      const secondMember = {
        ...baseMember,
        discordUserId: 'discord-456',
        discordUsername: 'Player2',
      };

      await service.handleVoiceJoin('binding-5', secondMember, baseBinding);

      expect(mockGracePeriodQueue.cancel).toHaveBeenCalledWith(200);
      expect(mockParticipantService.addParticipant).toHaveBeenCalledWith(
        200,
        secondMember,
      );
    });

    it('sets event reminders to false for ad-hoc events', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([{ name: 'Game' }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 300 }]);

      await service.handleVoiceJoin('binding-6', baseMember, baseBinding);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          isAdHoc: true,
          adHocStatus: 'live',
          reminder15min: false,
          reminder1hour: false,
          reminder24hour: false,
        }),
      );
    });
  });

  describe('handleVoiceLeave', () => {
    it('does nothing when no active event for binding', async () => {
      await service.handleVoiceLeave('nonexistent-binding', 'discord-123');

      expect(mockParticipantService.markLeave).not.toHaveBeenCalled();
    });

    it('marks participant as left and starts grace period when channel empties', async () => {
      // First set up an active event
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 400 }]);
      await service.handleVoiceJoin('binding-leave', baseMember, baseBinding);

      // Mock the getEvent DB call
      mockDb.limit.mockResolvedValueOnce([{
        id: 400,
        channelBindingId: 'binding-leave',
      }]);
      // Mock getBindingById
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-leave',
        config: { gracePeriod: 5 },
      });

      await service.handleVoiceLeave('binding-leave', 'discord-123');

      expect(mockParticipantService.markLeave).toHaveBeenCalledWith(
        400,
        'discord-123',
      );
      expect(mockGracePeriodQueue.enqueue).toHaveBeenCalledWith(
        400,
        5 * 60 * 1000,
      );
    });

    it('uses default 5 minute grace period when not configured', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 401 }]);
      await service.handleVoiceJoin('binding-default-grace', baseMember, baseBinding);

      mockDb.limit.mockResolvedValueOnce([{
        id: 401,
        channelBindingId: 'binding-default-grace',
      }]);
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-default-grace',
        config: null,
      });

      await service.handleVoiceLeave('binding-default-grace', 'discord-123');

      expect(mockGracePeriodQueue.enqueue).toHaveBeenCalledWith(
        401,
        5 * 60 * 1000,
      );
    });
  });

  describe('finalizeEvent', () => {
    it('finalizes event when status is grace_period', async () => {
      // finalizeEvent does: select().from().where().limit() then update().set().where()
      // The first .where() must return `this` (for chaining to .limit()).
      // The .limit() is the terminal for the select query.
      mockDb.limit.mockResolvedValueOnce([{
        id: 500,
        adHocStatus: 'grace_period',
        channelBindingId: 'binding-fin',
        duration: [new Date('2026-02-10T18:00:00Z'), new Date('2026-02-10T19:00:00Z')],
      }]);
      // The second .where() is the terminal for the update query — leave it as returnThis default

      await service.finalizeEvent(500);

      expect(mockParticipantService.finalizeAll).toHaveBeenCalledWith(500);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          adHocStatus: 'ended',
        }),
      );
    });

    it('skips finalization when event is not in grace_period', async () => {
      mockDb.limit.mockResolvedValueOnce([{
        id: 501,
        adHocStatus: 'live',
        channelBindingId: 'binding-fin2',
      }]);

      await service.finalizeEvent(501);

      expect(mockParticipantService.finalizeAll).not.toHaveBeenCalled();
    });

    it('skips finalization when event not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await service.finalizeEvent(999);

      expect(mockParticipantService.finalizeAll).not.toHaveBeenCalled();
    });

    it('removes binding from active events map', async () => {
      // Create an active event first
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 600 }]);
      await service.handleVoiceJoin('binding-cleanup', baseMember, baseBinding);

      expect(service.getActiveState('binding-cleanup')).toBeDefined();

      // Now finalize: select().from().where().limit() then update().set().where()
      mockDb.limit.mockResolvedValueOnce([{
        id: 600,
        adHocStatus: 'grace_period',
        channelBindingId: 'binding-cleanup',
        duration: [new Date(), new Date()],
      }]);
      // Don't set .where as mockResolvedValueOnce — it needs to returnThis for the select chain

      await service.finalizeEvent(600);

      expect(service.getActiveState('binding-cleanup')).toBeUndefined();
    });
  });

  describe('getAdHocRoster', () => {
    it('returns roster with active count', async () => {
      const mockParticipants = [
        {
          id: 'uuid-1',
          eventId: 42,
          userId: 1,
          discordUserId: 'discord-1',
          discordUsername: 'Player1',
          discordAvatarHash: null,
          joinedAt: '2026-02-10T18:00:00Z',
          leftAt: null,
          totalDurationSeconds: null,
          sessionCount: 1,
        },
      ];

      mockParticipantService.getRoster.mockResolvedValue(mockParticipants);
      mockParticipantService.getActiveCount.mockResolvedValue(1);

      const result = await service.getAdHocRoster(42);

      expect(result).toMatchObject({
        eventId: 42,
        participants: expect.any(Array),
        activeCount: 1,
      });
      expect(result.participants).toHaveLength(1);
    });
  });

  describe('getActiveState', () => {
    it('returns undefined when no active event for binding', () => {
      expect(service.getActiveState('nonexistent')).toBeUndefined();
    });

    it('returns state after event creation', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 700 }]);

      await service.handleVoiceJoin('binding-state', baseMember, baseBinding);

      const state = service.getActiveState('binding-state');
      expect(state).toBeDefined();
      expect(state?.eventId).toBe(700);
      expect(state?.memberSet.has('discord-123')).toBe(true);
    });
  });

  describe('onModuleInit', () => {
    it('recovers live ad-hoc events from database', async () => {
      const liveEvents = [
        {
          id: 800,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'binding-800',
        },
        {
          id: 801,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'binding-801',
        },
      ];

      mockDb.where.mockResolvedValueOnce(liveEvents);

      await service.onModuleInit();

      expect(service.getActiveState('binding-800')).toBeDefined();
      expect(service.getActiveState('binding-800')?.eventId).toBe(800);
      expect(service.getActiveState('binding-801')).toBeDefined();
    });

    it('skips events without channelBindingId', async () => {
      const liveEvents = [
        {
          id: 900,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: null,
        },
      ];

      mockDb.where.mockResolvedValueOnce(liveEvents);

      await service.onModuleInit();

      expect(service.getActiveState('')).toBeUndefined();
    });

    it('handles no live events', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await service.onModuleInit();

      // No error, no active state
      expect(service.getActiveState('anything')).toBeUndefined();
    });
  });
});
