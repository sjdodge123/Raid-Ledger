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
import { VoiceAttendanceService } from './voice-attendance.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
// ─── Test module builder ─────────────────────────────────────────────────────

const baseMember = {
  discordUserId: 'discord-100',
  discordUsername: 'LobbyPlayer',
  discordAvatarHash: null,
  userId: 5,
};

const generalLobbyBinding = {
  gameId: null,
  config: { minPlayers: 2, gracePeriod: 5, notificationChannelId: 'notif-ch' },
};

async function buildLobbyModule() {
  const mockDb = createDrizzleMock();
  const mockSettingsService = { get: jest.fn() };
  const mockParticipantService = {
    addParticipant: jest.fn().mockResolvedValue(undefined),
    markLeave: jest.fn().mockResolvedValue(undefined),
    getRoster: jest.fn().mockResolvedValue([]),
    getActiveCount: jest.fn().mockResolvedValue(0),
    finalizeAll: jest.fn().mockResolvedValue(undefined),
  };
  const mockChannelBindingsService = {
    getBindingById: jest.fn(),
    getBindings: jest.fn(),
  };
  const mockGracePeriodQueue = {
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
      { provide: ChannelBindingsService, useValue: mockChannelBindingsService },
      { provide: AdHocGracePeriodQueueService, useValue: mockGracePeriodQueue },
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
      {
        provide: VoiceAttendanceService,
        useValue: {
          handleJoin: jest.fn(),
          handleLeave: jest.fn(),
          getActiveCount: jest.fn().mockReturnValue(0),
        },
      },
    ],
  }).compile();

  const service = module.get(AdHocEventService);
  jest
    .spyOn(service as any, 'autoSignupParticipant')
    .mockResolvedValue(undefined);

  return {
    service,
    mockDb,
    mockSettingsService,
    mockParticipantService,
    mockChannelBindingsService,
    mockGracePeriodQueue,
  };
}

function mockLobbyEventCreation(
  mockDb: MockDb,
  id: number,
  bindingId: string,
  gameName?: string,
  gameId?: number | null,
) {
  mockDb.limit.mockResolvedValueOnce([]);
  if (gameName) {
    // When gameId is provided, buildAdHocTitle calls resolveGameName (ROK-817)
    if (gameId) {
      mockDb.limit.mockResolvedValueOnce([{ name: gameName }]);
    }
    mockDb.returning.mockResolvedValueOnce([{ id }]);
    mockDb.limit.mockResolvedValueOnce([
      {
        id,
        title: `${gameName} — Quick Play`,
        gameId: gameId ?? null,
        channelBindingId: bindingId,
      },
    ]);
  }
}

function mockGameBindingCreation(
  mockDb: MockDb,
  id: number,
  bindingId: string,
  gameName: string,
) {
  mockDb.limit.mockResolvedValueOnce([]);
  mockDb.limit.mockResolvedValueOnce([{ name: gameName }]);
  mockDb.returning.mockResolvedValueOnce([{ id }]);
  mockDb.limit.mockResolvedValueOnce([
    {
      id,
      title: `${gameName} — Quick Play`,
      gameId: 1,
      channelBindingId: bindingId,
    },
  ]);
  mockDb.limit.mockResolvedValueOnce([{ name: gameName }]);
}

describe('AdHocEventService — general lobby (ROK-515)', () => {
  let service: AdHocEventService;
  let mockDb: MockDb;
  let mockSettingsService: { get: jest.Mock };
  let mockParticipantService: Awaited<
    ReturnType<typeof buildLobbyModule>
  >['mockParticipantService'];
  let mockChannelBindingsService: {
    getBindingById: jest.Mock;
    getBindings: jest.Mock;
  };

  beforeEach(async () => {
    const ctx = await buildLobbyModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockSettingsService = ctx.mockSettingsService;
    mockParticipantService = ctx.mockParticipantService;
    mockChannelBindingsService = ctx.mockChannelBindingsService;
  });

  afterEach(() => jest.clearAllMocks());

  describe('composite key — game-specific binding', () => {
    it('uses composite key for game-specific binding', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockGameBindingCreation(mockDb, 10, 'bind-game', 'WoW');
      await service.handleVoiceJoin('bind-game', baseMember, {
        gameId: 1,
        config: null,
      });
      expect(service.getActiveState('bind-game', 1)).toBeDefined();
      expect(service.getActiveState('bind-game')).toBeUndefined();
    });
  });

  describe('composite key — general-lobby', () => {
    it('uses composite key for general-lobby with a detected game', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockLobbyEventCreation(mockDb, 20, 'bind-lobby', 'WoW', 7);
      await service.handleVoiceJoin(
        'bind-lobby',
        baseMember,
        generalLobbyBinding,
        7,
        'WoW',
      );
      expect(service.getActiveState('bind-lobby', 7)).toBeDefined();
      expect(service.getActiveState('bind-lobby')).toBeUndefined();
    });

    it('uses null composite key for general-lobby with no detected game', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockLobbyEventCreation(
        mockDb,
        30,
        'bind-lobby-null',
        'Untitled Gaming Session',
      );
      await service.handleVoiceJoin(
        'bind-lobby-null',
        baseMember,
        generalLobbyBinding,
        null,
        'Untitled Gaming Session',
      );
      expect(service.getActiveState('bind-lobby-null', null)).toBeDefined();
    });

    it('supports multiple concurrent game events per general-lobby channel', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockLobbyEventCreation(mockDb, 40, 'bind-multi', 'WoW', 1);
      await service.handleVoiceJoin(
        'bind-multi',
        baseMember,
        generalLobbyBinding,
        1,
        'WoW',
      );
      mockLobbyEventCreation(mockDb, 41, 'bind-multi', 'FFXIV', 2);
      const member2 = { ...baseMember, discordUserId: 'discord-200' };
      await service.handleVoiceJoin(
        'bind-multi',
        member2,
        generalLobbyBinding,
        2,
        'FFXIV',
      );
      expect(service.getActiveState('bind-multi', 1)).toBeDefined();
      expect(service.getActiveState('bind-multi', 2)).toBeDefined();
      expect(service.getActiveState('bind-multi', 1)?.eventId).toBe(40);
      expect(service.getActiveState('bind-multi', 2)?.eventId).toBe(41);
    });
  });

  describe('hasAnyActiveEvent — no events', () => {
    it('returns false when no events exist for binding', () => {
      expect(service.hasAnyActiveEvent('nonexistent')).toBe(false);
    });
  });

  describe('hasAnyActiveEvent — with events', () => {
    it('returns true for simple key (game-specific binding)', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockGameBindingCreation(mockDb, 50, 'bind-has', 'WoW');
      await service.handleVoiceJoin('bind-has', baseMember, {
        gameId: 1,
        config: null,
      });
      expect(service.hasAnyActiveEvent('bind-has')).toBe(true);
    });

    it('returns true for composite key (general-lobby binding)', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockLobbyEventCreation(mockDb, 60, 'bind-has-lobby', 'WoW', 5);
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
      mockLobbyEventCreation(mockDb, 70, 'bind-cleanup-has', 'WoW', 9);
      await service.handleVoiceJoin(
        'bind-cleanup-has',
        baseMember,
        generalLobbyBinding,
        9,
        'WoW',
      );
      expect(service.hasAnyActiveEvent('bind-cleanup-has')).toBe(true);
      await service.onEventCancelled({ eventId: 70 });
      expect(service.hasAnyActiveEvent('bind-cleanup-has')).toBe(false);
    });
  });

  describe('handleVoiceLeave — with gameId', () => {
    it('finds the correct composite key event when gameId is provided', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockLobbyEventCreation(mockDb, 80, 'bind-leave-gl', 'WoW', 3);
      await service.handleVoiceJoin(
        'bind-leave-gl',
        baseMember,
        generalLobbyBinding,
        3,
        'WoW',
      );
      expect(service.getActiveState('bind-leave-gl', 3)).toBeDefined();
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
  });

  describe('handleVoiceLeave — without gameId', () => {
    it('searches composite keys when gameId is not provided on leave', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockLobbyEventCreation(mockDb, 81, 'bind-scan', 'WoW', 4);
      await service.handleVoiceJoin(
        'bind-scan',
        baseMember,
        generalLobbyBinding,
        4,
        'WoW',
      );
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

  describe('onModuleInit recovery for general-lobby events', () => {
    it('recovers general-lobby events with composite key using event.gameId', async () => {
      mockDb.where.mockResolvedValueOnce([
        {
          id: 200,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'bind-recover',
          gameId: 5,
        },
      ]);
      await service.onModuleInit();
      expect(service.getActiveState('bind-recover', 5)).toBeDefined();
      expect(service.getActiveState('bind-recover', 5)?.eventId).toBe(200);
    });

    it('recovers game-specific events under simple key (no gameId on event)', async () => {
      mockDb.where.mockResolvedValueOnce([
        {
          id: 201,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'bind-recover-simple',
          gameId: null,
        },
      ]);
      await service.onModuleInit();
      expect(service.getActiveState('bind-recover-simple', null)).toBeDefined();
    });
  });

  describe('backward compatibility — event titles', () => {
    it('creates event with resolved game title when resolvedGameName provided', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockLobbyEventCreation(mockDb, 300, 'bind-title', 'Path of Exile', 11);
      await service.handleVoiceJoin(
        'bind-title',
        baseMember,
        generalLobbyBinding,
        11,
        'Path of Exile',
      );
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Path of Exile — Quick Play' }),
      );
    });

    it('uses "Gaming" title when binding has no game and no resolved name', async () => {
      mockSettingsService.get.mockResolvedValue('true');
      mockDb.limit.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValueOnce([{ id: 301 }]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 301,
          title: 'Gaming — Quick Play',
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
        expect.objectContaining({ title: 'Gaming — Quick Play' }),
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
