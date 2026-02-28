/**
 * ad-hoc-event.general-lobby.spec.ts
 *
 * Tests for ROK-515 additions to AdHocEventService:
 * - composite key strategy for general-lobby bindings
 * - handleVoiceJoin with resolvedGameId / resolvedGameName
 * - handleVoiceLeave with gameId parameter
 * - hasAnyActiveEvent
 * - onModuleInit recovery with composite keys
 * - backward compatibility: game-specific bindings still use simple keys
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AdHocEventService } from './ad-hoc-event.service';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { SettingsService } from '../../settings/settings.service';
import { UsersService } from '../../users/users.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
describe('AdHocEventService — general lobby (ROK-515)', () => {
  let service: AdHocEventService;
  let mockDb: MockDb;
  let mockSettingsService: { get: jest.Mock };
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
  let mockGracePeriodQueue: { enqueue: jest.Mock; cancel: jest.Mock };

  const baseMember = {
    discordUserId: 'discord-100',
    discordUsername: 'LobbyPlayer',
    discordAvatarHash: null,
    userId: 5,
  };

  // General-lobby binding: gameId is null
  const generalLobbyBinding = {
    gameId: null,
    config: {
      minPlayers: 2,
      gracePeriod: 5,
      notificationChannelId: 'notif-ch',
    },
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    mockSettingsService = { get: jest.fn() };

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

    mockGracePeriodQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdHocEventService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: UsersService, useValue: { findByDiscordId: jest.fn() } },
        { provide: AdHocParticipantService, useValue: mockParticipantService },
        {
          provide: ChannelBindingsService,
          useValue: mockChannelBindingsService,
        },
        {
          provide: AdHocGracePeriodQueueService,
          useValue: mockGracePeriodQueue,
        },
        {
          provide: AdHocNotificationService,
          useValue: {
            notifySpawn: jest.fn(),
            queueUpdate: jest.fn(),
            notifyCompleted: jest.fn(),
            flush: jest.fn(),
          },
        },
        {
          provide: AdHocEventsGateway,
          useValue: {
            emitRosterUpdate: jest.fn(),
            emitStatusChange: jest.fn(),
            emitEndTimeExtended: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AdHocEventService);

    // Stub autoSignupParticipant to isolate tests
    jest
      .spyOn(service as any, 'autoSignupParticipant')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  // ─── Composite key construction ────────────────────────────────────────────

  describe('composite key strategy', () => {
    it('uses composite key for game-specific binding (binding.gameId used as effectiveGameId)', async () => {
      // When resolvedGameId is not passed, effectiveGameId = binding.gameId.
      // buildEventKey('bind-game', 1) → 'bind-game:1' (composite key)
      mockSettingsService.get.mockResolvedValue('true');
      // no scheduled event
      mockDb.limit.mockResolvedValueOnce([]);
      // game name lookup (binding has gameId, no resolvedGameName)
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      // insert returning
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);
      // getEvent for notification
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 10,
          title: 'WoW — Ad-Hoc Session',
          gameId: 1,
          channelBindingId: 'bind-game',
        },
      ]);
      // game name for notify
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);

      await service.handleVoiceJoin('bind-game', baseMember, {
        gameId: 1,
        config: null,
      });

      // With gameId=1 on the binding, composite key 'bind-game:1' is used
      expect(service.getActiveState('bind-game', 1)).toBeDefined();
      // Simple key without gameId suffix does NOT exist
      expect(service.getActiveState('bind-game')).toBeUndefined();
    });

    it('uses composite key for general-lobby with a detected game', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      // no scheduled event
      mockDb.limit.mockResolvedValueOnce([]);
      // insert returning (no game name lookup since resolvedGameName is provided)
      mockDb.returning.mockResolvedValueOnce([{ id: 20 }]);
      // getEvent for notification
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 20,
          title: 'WoW — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-lobby',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-lobby',
        baseMember,
        generalLobbyBinding,
        7, // resolvedGameId
        'WoW', // resolvedGameName
      );

      // Composite key 'bind-lobby:7' should exist
      expect(service.getActiveState('bind-lobby', 7)).toBeDefined();
      // Simple key should NOT exist
      expect(service.getActiveState('bind-lobby')).toBeUndefined();
    });

    it('uses null composite key for general-lobby with no detected game', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      // no scheduled event
      mockDb.limit.mockResolvedValueOnce([]);
      // insert returning
      mockDb.returning.mockResolvedValueOnce([{ id: 30 }]);
      // getEvent for notification
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 30,
          title: 'Untitled Gaming Session — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-lobby-null',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-lobby-null',
        baseMember,
        generalLobbyBinding,
        null, // resolvedGameId = null
        'Untitled Gaming Session',
      );

      // Key should be 'bind-lobby-null:null'
      expect(service.getActiveState('bind-lobby-null', null)).toBeDefined();
    });

    it('supports multiple concurrent game events per general-lobby channel', async () => {
      mockSettingsService.get.mockResolvedValue('true');

      // Create event for WoW (gameId=1)
      mockDb.limit.mockResolvedValueOnce([]); // no scheduled event
      mockDb.returning.mockResolvedValueOnce([{ id: 40 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 40,
          title: 'WoW — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-multi',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-multi',
        baseMember,
        generalLobbyBinding,
        1,
        'WoW',
      );

      // Create event for FFXIV (gameId=2)
      mockDb.limit.mockResolvedValueOnce([]); // no scheduled event (different key)
      mockDb.returning.mockResolvedValueOnce([{ id: 41 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 41,
          title: 'FFXIV — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-multi',
        },
      ]);

      const member2 = { ...baseMember, discordUserId: 'discord-200' };
      await service.handleVoiceJoin(
        'bind-multi',
        member2,
        generalLobbyBinding,
        2,
        'FFXIV',
      );

      // Both composite keys should exist independently
      expect(service.getActiveState('bind-multi', 1)).toBeDefined();
      expect(service.getActiveState('bind-multi', 2)).toBeDefined();
      expect(service.getActiveState('bind-multi', 1)?.eventId).toBe(40);
      expect(service.getActiveState('bind-multi', 2)?.eventId).toBe(41);
    });
  });

  // ─── hasAnyActiveEvent ─────────────────────────────────────────────────────

  describe('hasAnyActiveEvent', () => {
    it('returns false when no events exist for binding', () => {
      expect(service.hasAnyActiveEvent('nonexistent')).toBe(false);
    });

    it('returns true for simple key (game-specific binding)', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([]);
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 50 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 50,
          title: 'WoW — Ad-Hoc Session',
          gameId: 1,
          channelBindingId: 'bind-has',
        },
      ]);
      mockDb.limit.mockResolvedValueOnce([{ name: 'WoW' }]);

      await service.handleVoiceJoin('bind-has', baseMember, {
        gameId: 1,
        config: null,
      });

      expect(service.hasAnyActiveEvent('bind-has')).toBe(true);
    });

    it('returns true for composite key (general-lobby binding)', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValueOnce([{ id: 60 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 60,
          title: 'WoW — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-has-lobby',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-has-lobby',
        baseMember,
        generalLobbyBinding,
        5,
        'WoW',
      );

      expect(service.hasAnyActiveEvent('bind-has-lobby')).toBe(true);
    });

    it('returns false after event is cleaned up', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValueOnce([{ id: 70 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 70,
          title: 'WoW — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-cleanup-has',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-cleanup-has',
        baseMember,
        generalLobbyBinding,
        9,
        'WoW',
      );

      expect(service.hasAnyActiveEvent('bind-cleanup-has')).toBe(true);

      // Cancel removes the event from map
      await service.onEventCancelled({ eventId: 70 });

      expect(service.hasAnyActiveEvent('bind-cleanup-has')).toBe(false);
    });
  });

  // ─── handleVoiceLeave with gameId ─────────────────────────────────────────

  describe('handleVoiceLeave with composite key', () => {
    it('finds the correct composite key event when gameId is provided', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      // Set up general-lobby event
      mockDb.limit.mockResolvedValueOnce([]); // no scheduled event
      mockDb.returning.mockResolvedValueOnce([{ id: 80 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 80,
          title: 'WoW — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-leave-gl',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-leave-gl',
        baseMember,
        generalLobbyBinding,
        3,
        'WoW',
      );

      // Verify event is active
      expect(service.getActiveState('bind-leave-gl', 3)).toBeDefined();

      // Leave: provide gameId so it can find composite key
      mockDb.limit.mockResolvedValueOnce([
        { id: 80, adHocStatus: 'live', channelBindingId: 'bind-leave-gl' },
      ]);
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'bind-leave-gl',
        config: { gracePeriod: 5 },
      });

      await service.handleVoiceLeave('bind-leave-gl', 'discord-100', 3);

      expect(mockParticipantService.markLeave).toHaveBeenCalledWith(
        80,
        'discord-100',
      );
    });

    it('searches composite keys when gameId is not provided on leave', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([]); // no scheduled event
      mockDb.returning.mockResolvedValueOnce([{ id: 81 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 81,
          title: 'WoW — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-scan',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-scan',
        baseMember,
        generalLobbyBinding,
        4,
        'WoW',
      );

      // Leave without gameId — should scan composite keys
      mockDb.limit.mockResolvedValueOnce([
        { id: 81, adHocStatus: 'live', channelBindingId: 'bind-scan' },
      ]);
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'bind-scan',
        config: { gracePeriod: 5 },
      });

      await service.handleVoiceLeave('bind-scan', 'discord-100');

      expect(mockParticipantService.markLeave).toHaveBeenCalledWith(
        81,
        'discord-100',
      );
    });
  });

  // ─── onModuleInit recovery with composite keys ─────────────────────────────

  describe('onModuleInit recovery for general-lobby events', () => {
    it('recovers general-lobby events with composite key using event.gameId', async () => {
      // Simulate a live event that was created for general-lobby with gameId 5
      const liveEvents = [
        {
          id: 200,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'bind-recover',
          gameId: 5, // indicates general-lobby composite key
        },
      ];

      mockDb.where.mockResolvedValueOnce(liveEvents);

      await service.onModuleInit();

      // Should be recovered under composite key 'bind-recover:5'
      expect(service.getActiveState('bind-recover', 5)).toBeDefined();
      expect(service.getActiveState('bind-recover', 5)?.eventId).toBe(200);
    });

    it('recovers game-specific events under simple key (no gameId on event)', async () => {
      const liveEvents = [
        {
          id: 201,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'bind-recover-simple',
          gameId: null,
        },
      ];

      mockDb.where.mockResolvedValueOnce(liveEvents);

      await service.onModuleInit();

      // gameId is null → composite key 'bind-recover-simple:null'
      expect(service.getActiveState('bind-recover-simple', null)).toBeDefined();
    });
  });

  // ─── backward compatibility ────────────────────────────────────────────────

  describe('backward compatibility with game-specific bindings', () => {
    it('creates event with resolved game title when resolvedGameName provided', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([]); // no scheduled event
      // no game name lookup — resolvedGameName is provided
      mockDb.returning.mockResolvedValueOnce([{ id: 300 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 300,
          title: 'Path of Exile — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-title',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-title',
        baseMember,
        generalLobbyBinding,
        11,
        'Path of Exile',
      );

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Path of Exile — Ad-Hoc Session',
        }),
      );
    });

    it('uses "Gaming" title when binding has no game and no resolved name', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([]); // no scheduled event
      // No game name provided, no gameId
      mockDb.returning.mockResolvedValueOnce([{ id: 301 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 301,
          title: 'Gaming — Ad-Hoc Session',
          gameId: null,
          channelBindingId: 'bind-gaming',
        },
      ]);

      await service.handleVoiceJoin(
        'bind-gaming',
        baseMember,
        generalLobbyBinding,
      );

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Gaming — Ad-Hoc Session',
        }),
      );
    });

    it('feature disabled: does not create event regardless of resolvedGameId', async () => {
      mockSettingsService.get.mockResolvedValue('false');

      await service.handleVoiceJoin(
        'bind-disabled',
        baseMember,
        generalLobbyBinding,
        5,
        'WoW',
      );

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockParticipantService.addParticipant).not.toHaveBeenCalled();
    });
  });
});
